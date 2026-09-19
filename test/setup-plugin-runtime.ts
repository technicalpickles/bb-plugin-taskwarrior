// The SDK's `@get-bb/plugin-sdk/app` binds hooks (useRpc, useRealtime, ...) from
// a global at import time. Install the test runtime before any component loads.
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();

// Vitest globals are off, so Testing Library's auto-cleanup never registers.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
