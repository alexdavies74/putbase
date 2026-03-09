import { CLASSIC_WORKER_RUNTIME } from "./dist/generated-runtime";

function escapeForLiteral(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
}

export function buildClassicWorkerScript(args: {
  roomId: string;
  roomName: string;
  owner: string;
  workerUrl: string;
}): string {
  return CLASSIC_WORKER_RUNTIME
    .replaceAll("__PUTER_FED_ROOM_ID__", escapeForLiteral(args.roomId))
    .replaceAll("__PUTER_FED_ROOM_NAME__", escapeForLiteral(args.roomName))
    .replaceAll("__PUTER_FED_ROOM_OWNER__", escapeForLiteral(args.owner))
    .replaceAll("__PUTER_FED_ROOM_WORKER_URL__", escapeForLiteral(args.workerUrl));
}
