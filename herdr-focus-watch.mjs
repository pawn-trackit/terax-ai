#!/usr/bin/env node
// herdr-focus-watch.mjs — herdr의 "활성 워크스페이스(=워크트리 루트)"를 실시간 추적하는 최소 PoC.
//
// herdr 안에서 포커스가 다른 워크트리로 옮겨갈 때마다 그 워크트리 루트 경로를 출력한다.
// 이 값이 곧 사이드바 파일트리의 루트가 된다. (같은 워크스페이스 내 pane/탭 전환에는 반응하지 않음.)
//
// 프로토콜 사실(검증): 구독 연결은 "이벤트 전용"이다. events.subscribe 한 연결에
// 다른 요청(workspace.list 등)을 섞어 보내면 서버가 그 연결을 닫는다. 따라서 연결을 둘로 나눈다:
//   (1) 이벤트 전용 연결 — workspace.focused push만 받는다.
//   (2) 조회용 단발 연결 — 포커스가 바뀔 때마다 짧게 열어 현재 포커스된 워크트리 루트를 읽는다.
// 실제 앱(Tauri)에서는 (1)을 tokio UnixStream 상주 태스크로, (2)를 요청마다 여는 호출로 옮기면 1:1 대응된다.
//
// 실행:  node herdr-focus-watch.mjs        종료:  Ctrl-C

import net from "node:net";
import os from "node:os";
import path from "node:path";

const SOCKET_PATH =
  process.env.HERDR_SOCKET_PATH ||
  path.join(os.homedir(), ".config/herdr/herdr.sock");

const stamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });

// (2) 조회용 단발 연결 — 한 요청을 보내고 첫 응답 한 줄을 받아 닫는다.
function request(reqObj) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection({ path: SOCKET_PATH });
    let b = "";
    c.on("connect", () => c.write(JSON.stringify(reqObj) + "\n"));
    c.on("data", (chunk) => {
      b += chunk.toString("utf8");
      const nl = b.indexOf("\n");
      if (nl >= 0) { c.end(); try { resolve(JSON.parse(b.slice(0, nl))); } catch (e) { reject(e); } }
    });
    c.on("error", reject);
  });
}

let current = null; // 마지막으로 출력한 루트 (중복 출력 방지)

// 포커스된 워크스페이스의 루트를 정한다: git 워크트리가 있으면 그 루트(워크스페이스 단위 바인딩),
// 없으면(비-git 워크스페이스) 포커스된 pane의 cwd로 폴백해 트리가 비지 않게 한다.
async function focusedRoot() {
  const wl = await request({ id: "list", method: "workspace.list", params: {} });
  const ws = wl.result?.workspaces?.find((w) => w.focused);
  if (!ws) return null;
  if (ws.worktree?.checkout_path) return { root: ws.worktree.checkout_path, label: ws.label, kind: "worktree" };
  const pl = await request({ id: "panes", method: "pane.list", params: {} });
  const cwd = pl.result?.panes?.find((p) => p.focused)?.cwd;
  return { root: cwd, label: ws.label, kind: "cwd" };
}

async function report() {
  const f = await focusedRoot();
  if (f?.root && f.root !== current) {
    current = f.root;
    const tag = f.kind === "worktree" ? "워크트리" : "cwd";
    console.log(`[${stamp()}] ▶ 사이드바 루트 = ${f.root}   (${f.label} · ${tag})`);
  }
}

// (1) 이벤트 전용 연결 — workspace.focused push만 받는다.
const events = net.createConnection({ path: SOCKET_PATH });
events.on("connect", () => {
  events.write(JSON.stringify({ id: "sub", method: "events.subscribe",
    params: { subscriptions: [{ type: "workspace.focused" }] } }) + "\n");
  report(); // 시작 시점의 현재 포커스도 한 번 출력
});

let buf = "";
events.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.result?.type === "subscription_started") continue; // 구독 ack는 무시
    if (msg.event || msg.data) report();                       // 포커스 변경 → 재조회
  }
});

events.on("error", (e) => {
  console.error(`herdr 소켓 연결 실패 (${SOCKET_PATH}): ${e.message}`);
  process.exit(1);
});
events.on("close", () => process.exit(0));
console.error(
  `herdr 포커스 추적 시작 — ${SOCKET_PATH}\n` +
  `herdr에서 워크스페이스를 전환하면 아래에 루트 경로가 갱신됩니다. (Ctrl-C 종료)`
);
