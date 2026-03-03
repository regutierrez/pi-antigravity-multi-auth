import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getCooldownMs, setAccountEnabled, setActiveAccount, removeAccountAtIndex } from "./accounts.js";
import { mutateAccountStore, updateAccountStore, withLoadedAccountStore } from "./storage.js";
import type { ModelFamily } from "./types.js";
import { formatDuration } from "./utils.js";

const COMMAND_NAME = "ag-accounts";

type ParsedCommand =
  | { action: "list" }
  | { action: "enable"; index: number }
  | { action: "disable"; index: number }
  | { action: "set-active"; family: ModelFamily; index: number | null }
  | { action: "remove"; index: number }
  | { action: "help" };

function parseIndex(value: string | undefined): number {
  if (!value) {
    throw new Error("Missing account index");
  }

  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index) || index < 0) {
    throw new Error(`Invalid account index: ${value}`);
  }

  return index;
}

function parseFamily(value: string | undefined): ModelFamily {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "claude" || normalized === "gemini") {
    return normalized;
  }

  throw new Error(`Invalid family: ${value || "<missing>"}. Expected claude or gemini.`);
}

function parseCommand(args: string): ParsedCommand {
  const tokens = args
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const firstToken = tokens[0];
  if (!firstToken || firstToken === "list") {
    return { action: "list" };
  }

  const action = firstToken.toLowerCase();

  if (action === "help") {
    return { action: "help" };
  }

  if (action === "enable") {
    return {
      action: "enable",
      index: parseIndex(tokens[1])
    };
  }

  if (action === "disable") {
    return {
      action: "disable",
      index: parseIndex(tokens[1])
    };
  }

  if (action === "remove") {
    return {
      action: "remove",
      index: parseIndex(tokens[1])
    };
  }

  if (action === "set-active") {
    const family = parseFamily(tokens[1]);
    const rawIndex = tokens[2];
    const index = rawIndex === undefined || rawIndex.toLowerCase() === "none" ? null : parseIndex(rawIndex);

    return {
      action: "set-active",
      family,
      index
    };
  }

  throw new Error(`Unknown action: ${firstToken}`);
}

async function renderAccountList(): Promise<string> {
  return withLoadedAccountStore((store) => {
    if (store.accounts.length === 0) {
      return "No Antigravity accounts configured. Run /login google-antigravity-multi.";
    }

    const lines = ["Antigravity account pool:"];

    for (const [index, account] of store.accounts.entries()) {
      const status = account.enabled ? "enabled" : "disabled";
      const activeMarkers: string[] = [];
      if (store.activeIndexByFamily.claude === index) {
        activeMarkers.push("claude*");
      }
      if (store.activeIndexByFamily.gemini === index) {
        activeMarkers.push("gemini*");
      }

      const claudeCooldown = formatDuration(getCooldownMs(account, "claude"));
      const geminiCooldown = formatDuration(getCooldownMs(account, "gemini"));

      lines.push(
        `#${index} ${account.email} [${status}]` +
          (activeMarkers.length > 0 ? ` (${activeMarkers.join(", ")})` : "") +
          ` project=${account.projectId}`
      );
      lines.push(`    cooldown: claude=${claudeCooldown}, gemini=${geminiCooldown}`);
    }

    return lines.join("\n");
  });
}

function helpText(): string {
  return [
    "Usage: /ag-accounts [action]",
    "",
    "Actions:",
    "  list                           Show accounts and cooldown status",
    "  enable <index>                 Enable an account",
    "  disable <index>                Disable an account",
    "  set-active <family> <index>    Set active account for claude|gemini",
    "  set-active <family> none       Clear active account for family",
    "  remove <index>                 Remove account from pool",
    "  help                           Show this help"
  ].join("\n");
}

export function registerAccountCommands(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Manage Antigravity multi-account pool",
    handler: async (args, ctx) => {
      try {
        const command = parseCommand(args || "");

        if (command.action === "help") {
          ctx.ui.notify(helpText(), "info");
          return;
        }

        if (command.action === "list") {
          ctx.ui.notify(await renderAccountList(), "info");
          return;
        }

        if (command.action === "enable" || command.action === "disable") {
          const enabled = command.action === "enable";
          const email = await mutateAccountStore((store) => {
            setAccountEnabled(store, command.index, enabled);
            return { store, result: store.accounts[command.index]?.email ?? "<unknown>" };
          });
          ctx.ui.notify(`${enabled ? "Enabled" : "Disabled"} account #${command.index} (${email})`, "info");
          return;
        }

        if (command.action === "set-active") {
          await updateAccountStore((store) => {
            setActiveAccount(store, command.family, command.index);
          });
          const label = command.index === null ? "none" : `#${command.index}`;
          ctx.ui.notify(`Set ${command.family} active account to ${label}`, "info");
          return;
        }

        if (command.action === "remove") {
          const removedEmail = await mutateAccountStore((store) => {
            const email = store.accounts[command.index]?.email;
            removeAccountAtIndex(store, command.index);
            return {
              store,
              result: email ?? "<unknown>"
            };
          });
          ctx.ui.notify(`Removed account #${command.index} (${removedEmail})`, "warning");
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`/${COMMAND_NAME} failed: ${message}`, "error");
      }
    }
  });
}
