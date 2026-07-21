import { runtimeErrorCode, type RuntimeErrorCode } from "../errors.js";
import type { RecentRequest, RuntimeStateStore } from "../state.js";
import { RuntimeController } from "../controller/runtime-controller.js";
import {
  CONTROL_PROTOCOL_VERSION,
  ControlResponseSchema,
  type ControlDispatchResult,
  type ControlResponse,
} from "./result.js";
import type { ControlRequest } from "./protocol.js";

interface CachedResponse {
  readonly command: ControlRequest["command"];
  readonly response: ControlResponse;
}

interface InFlightRequest {
  readonly command: ControlRequest["command"];
  readonly result: Promise<ControlDispatchResult>;
}

type MutationRequest = Exclude<ControlRequest, { readonly command: "status" }>;

function errorMessage(code: RuntimeErrorCode): string {
  if (code === "RUNTIME_BUSY") return "Another Runtime command is in progress.";
  if (code === "RUNTIME_CONTROL_UNAVAILABLE") return "Runtime control is unavailable.";
  if (code === "RESTORE_AWAITING_EXIT") return "Codex must exit normally before changing themes.";
  if (code === "CODEX_WINDOW_ACTIVATION_FAILED") {
    return "Codex window activation could not be verified safely.";
  }
  if (code === "PROCESS_INSPECTION_DENIED") {
    return "Codex process identity could not be inspected safely.";
  }
  if (code === "ADAPTER_INCOMPATIBLE") {
    return "The installed Codex UI is not compatible with this OpenChatGPTSkin adapter.";
  }
  if (code === "INTERNAL") return "The Runtime command could not be completed.";
  return "The Runtime command was rejected safely.";
}

function errorNextAction(code: RuntimeErrorCode): string {
  if (code === "CODEX_WINDOW_ACTIVATION_FAILED") {
    return "Quit Codex completely and retry once. If it repeats, report " +
      "CODEX_WINDOW_ACTIVATION_FAILED with the installed Codex version.";
  }
  if (code === "PROCESS_INSPECTION_DENIED") {
    return "Quit Codex completely and retry once. If it repeats, report " +
      "PROCESS_INSPECTION_DENIED with the installed Codex version.";
  }
  if (code === "ADAPTER_INCOMPATIBLE") {
    return "Update OpenChatGPTSkin before retrying. If no update is available, report " +
      "ADAPTER_INCOMPATIBLE with the installed Codex version.";
  }
  return "Review Runtime status and retry with a new request ID.";
}

function errorResponse(
  request: ControlRequest,
  code: RuntimeErrorCode,
): ControlResponse {
  return ControlResponseSchema.parse({
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    requestId: request.requestId,
    ok: false,
    error: {
      code,
      message: errorMessage(code),
      nextAction: errorNextAction(code),
    },
  });
}

function successResponse(
  request: ControlRequest,
  result: Awaited<ReturnType<RuntimeController["status"]>>,
): ControlResponse {
  return ControlResponseSchema.parse({
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    requestId: request.requestId,
    ok: true,
    result,
  });
}

export class RuntimeControlDispatcher {
  private mutation: Promise<void> | null = null;
  private readonly cache = new Map<string, CachedResponse>();
  private readonly inFlight = new Map<string, InFlightRequest>();

  constructor(
    private readonly controller: RuntimeController,
    private readonly state: RuntimeStateStore,
  ) {}

  async dispatch(request: ControlRequest): Promise<ControlDispatchResult> {
    try {
      const cached = await this.lookup(request);
      if (cached) return { response: cached };

      const inFlight = this.inFlight.get(request.requestId);
      if (inFlight) {
        if (inFlight.command !== request.command) {
          return this.complete(request, errorResponse(request, "RUNTIME_CONTROL_UNAVAILABLE"));
        }
        return inFlight.result.then(({ response }) => ({ response }));
      }

      if (request.command === "status") {
        return this.executeStatus(request);
      }

      if (this.mutation) {
        return this.complete(request, errorResponse(request, "RUNTIME_BUSY"));
      }

      const result = this.executeMutation(request);
      this.inFlight.set(request.requestId, { command: request.command, result });
      try {
        return await result;
      } finally {
        this.inFlight.delete(request.requestId);
      }
    } catch (error) {
      return this.complete(request, errorResponse(request, runtimeErrorCode(error)));
    }
  }

  private async lookup(request: ControlRequest): Promise<ControlResponse | null> {
    const persistent = await this.state.read();
    const stored = persistent?.recentRequests.find((entry) => entry.requestId === request.requestId);
    if (stored) return this.matchStoredRequest(request, stored);

    const cached = this.cache.get(request.requestId);
    if (!cached) return null;
    if (cached.command !== request.command) {
      return errorResponse(request, "RUNTIME_CONTROL_UNAVAILABLE");
    }
    return cached.response;
  }

  private matchStoredRequest(
    request: ControlRequest,
    stored: RecentRequest,
  ): ControlResponse {
    if (stored.command !== request.command || stored.response.requestId !== request.requestId) {
      return errorResponse(request, "RUNTIME_CONTROL_UNAVAILABLE");
    }
    this.remember(stored.requestId, { command: stored.command, response: stored.response });
    return stored.response;
  }

  private async executeStatus(request: ControlRequest): Promise<ControlDispatchResult> {
    try {
      return await this.complete(request, successResponse(request, await this.controller.status()));
    } catch (error) {
      return this.complete(request, errorResponse(request, runtimeErrorCode(error)));
    }
  }

  private async executeMutation(request: MutationRequest): Promise<ControlDispatchResult> {
    let release!: () => void;
    this.mutation = new Promise<void>((resolve) => { release = resolve; });
    try {
      const result = await this.executeControllerCommand(request);
      const response = successResponse(request, result);
      const afterResponse = request.command === "restore"
        ? await this.terminalExitMonitorCallback()
        : undefined;
      return this.complete(request, response, afterResponse);
    } catch (error) {
      const afterResponse = request.command === "launch"
        ? await this.terminalExitMonitorCallback()
        : undefined;
      return this.complete(
        request,
        errorResponse(request, runtimeErrorCode(error)),
        afterResponse,
      );
    } finally {
      release();
      this.mutation = null;
    }
  }

  private async executeControllerCommand(
    request: MutationRequest,
  ): Promise<Awaited<ReturnType<RuntimeController["status"]>>> {
    switch (request.command) {
      case "launch":
        return this.controller.launch(
          request.params.themeId,
          request.requestId,
          request.params.themeVersion,
        );
      case "switch":
        return this.controller.switchTheme(
          request.params.themeId,
          request.requestId,
          request.params.themeVersion,
        );
      case "pause":
        return this.controller.pause(request.requestId);
      case "resume":
        return this.controller.resume(request.requestId);
      case "restore":
        return this.controller.restore(request.requestId);
    }
  }

  private async terminalExitMonitorCallback(): Promise<ControlDispatchResult["afterResponse"]> {
    const session = await this.state.read();
    if (session?.status !== "restored-awaiting-exit" &&
      session?.status !== "restored-cleanup-required") {
      return undefined;
    }
    return () => this.controller.startExitMonitoring();
  }

  private async complete(
    request: ControlRequest,
    response: ControlResponse,
    afterResponse?: () => Promise<void> | void,
  ): Promise<ControlDispatchResult> {
    const parsed = ControlResponseSchema.parse(response);
    const record: RecentRequest = {
      requestId: request.requestId,
      command: request.command,
      response: parsed,
      completedAt: new Date().toISOString(),
    };
    try {
      await this.state.appendRecentRequest(record);
    } catch (error) {
      const persistenceFailure = errorResponse(request, runtimeErrorCode(error));
      this.remember(request.requestId, {
        command: request.command,
        response: persistenceFailure,
      });
      return { response: persistenceFailure };
    }
    this.remember(request.requestId, { command: request.command, response: parsed });
    return afterResponse ? { response: parsed, afterResponse } : { response: parsed };
  }

  private remember(requestId: string, value: CachedResponse): void {
    this.cache.delete(requestId);
    this.cache.set(requestId, value);
    while (this.cache.size > 32) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) return;
      this.cache.delete(oldest);
    }
  }
}
