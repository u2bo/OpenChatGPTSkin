import type { ControlRequest } from "./protocol.js";
import type { ControlDispatchResult } from "./result.js";
import { SecurePipeServer } from "./pipe-server.js";
import { SecureUnixSocketServer } from "./unix-socket-server.js";
import { RuntimeError } from "../errors.js";

export interface SecureControlServer {
  readonly securityVerified: boolean;
  close(): Promise<void>;
}

export interface StartSecureControlServerOptions {
  readonly platform?: NodeJS.Platform;
  readonly userIdentity: string;
  readonly dispatch: (request: ControlRequest) => Promise<ControlDispatchResult>;
}

export async function startSecureControlServer(
  options: StartSecureControlServerOptions,
): Promise<SecureControlServer> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const pipe = await SecurePipeServer.start({
      sid: options.userIdentity,
      dispatch: options.dispatch,
    });
    return {
      securityVerified: pipe.aclVerified,
      close: () => pipe.close(),
    };
  }
  if (platform === "darwin") {
    const socket = await SecureUnixSocketServer.start({
      userIdentity: options.userIdentity,
      dispatch: options.dispatch,
      platform,
    });
    return {
      securityVerified: socket.permissionsVerified,
      close: () => socket.close(),
    };
  }
  throw new RuntimeError(
    "RUNTIME_ENVIRONMENT_INVALID",
    `Unsupported Runtime control platform: ${platform}`,
  );
}
