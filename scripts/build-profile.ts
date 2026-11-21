import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_UUID = "com.charlesbine.t3-deck";
const PLUGIN_META = {
  Name: "T3 Deck",
  UUID: PLUGIN_UUID,
  Version: "1.0.0.0"
};

// Deterministic UUIDs so re-running build:profile produces clean, reproducible archives
const PROFILE_UUID = "6B7A9E42-3D4F-4E91-8A55-73D3C4E10001";
const DEFAULT_PAGE_UUID = "6B7A9E42-3D4F-4E91-8A55-73D3C4E10002";
const MAIN_PAGE_UUID = "6B7A9E42-3D4F-4E91-8A55-73D3C4E10003";

function makeAction(
  actionId: string,
  name: string,
  uuid: string,
  settings: Record<string, unknown> = {}
) {
  return {
    ActionID: actionId,
    LinkedTitle: false,
    Name: name,
    Plugin: PLUGIN_META,
    Resources: null,
    Settings: settings,
    State: 0,
    States: [
      {
        FontFamily: "",
        FontSize: 12,
        FontStyle: "",
        FontUnderline: false,
        OutlineThickness: 2,
        ShowTitle: false,
        TitleAlignment: "bottom",
        TitleColor: "#ffffff"
      }
    ],
    UUID: uuid
  };
}

const mainPageManifest = {
  Controllers: [
    {
      Actions: {
        "0,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10101",
          "Fleet Pulse",
          `${PLUGIN_UUID}.fleet-attention`
        ),
        "1,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10102",
          "Approve / Answer",
          `${PLUGIN_UUID}.approve`
        ),
        "2,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10103",
          "Stop / Deny",
          `${PLUGIN_UUID}.stop-deny`
        ),
        "3,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10104",
          "Settle / Pin",
          `${PLUGIN_UUID}.settle-pin`
        ),
        "0,1": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10105",
          "New Chat",
          `${PLUGIN_UUID}.new-thread`
        ),
        "1,1": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10106",
          "Send / Steer Prompt",
          `${PLUGIN_UUID}.quick-prompt`,
          { label: "CONTINUE", prompt: "Continue", mode: "auto" }
        ),
        "2,1": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10107",
          "Open Thread / PR",
          `${PLUGIN_UUID}.open-thread`
        ),
        "3,1": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10108",
          "Snooze / Sync",
          `${PLUGIN_UUID}.snooze-sync`
        )
      },
      Type: "Keypad"
    },
    {
      Actions: {
        "0,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10201",
          "Thread Navigator",
          `${PLUGIN_UUID}.thread-dial`
        ),
        "1,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10202",
          "Model & Provider",
          `${PLUGIN_UUID}.model-dial`
        ),
        "2,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10203",
          "Mode & Effort",
          `${PLUGIN_UUID}.mode-dial`
        ),
        "3,0": makeAction(
          "6b7a9e42-3d4f-4e91-8a55-73d3c4e10204",
          "Usage Radar",
          `${PLUGIN_UUID}.usage-dial`
        )
      },
      Type: "Encoder"
    }
  ],
  Icon: "",
  Name: ""
};

const emptyPageManifest = {
  Controllers: [
    { Actions: null, Type: "Keypad" },
    { Actions: null, Type: "Encoder" }
  ],
  Icon: "",
  Name: ""
};

const profileManifest = {
  Device: {
    Model: "20GBD9901",
    UUID: "6b7a9e42-3d4f-4e91-8a55-73d3c4e10000"
  },
  Name: "T3 Deck",
  Pages: {
    Current: "00000000-0000-0000-0000-000000000000",
    Default: DEFAULT_PAGE_UUID.toLowerCase(),
    Pages: [MAIN_PAGE_UUID.toLowerCase()]
  },
  Version: "3.0"
};

const packageMeta = {
  AppVersion: "7.5.0.22885",
  DeviceModel: "20GBD9901",
  DeviceSettings: null,
  FormatVersion: 1,
  OSType: "macOS",
  OSVersion: "13.0",
  RequiredPlugins: [PLUGIN_UUID]
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-deck-profile-"));
try {
  const profRoot = path.join(tmpDir, "Profiles", `${PROFILE_UUID}.sdProfile`);
  const defaultDir = path.join(profRoot, "Profiles", DEFAULT_PAGE_UUID);
  const mainDir = path.join(profRoot, "Profiles", MAIN_PAGE_UUID);
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.mkdirSync(mainDir, { recursive: true });

  fs.writeFileSync(path.join(tmpDir, "package.json"), `${JSON.stringify(packageMeta, null, 2)}\n`);
  fs.writeFileSync(path.join(profRoot, "manifest.json"), `${JSON.stringify(profileManifest, null, 2)}\n`);
  fs.writeFileSync(path.join(defaultDir, "manifest.json"), `${JSON.stringify(emptyPageManifest, null, 2)}\n`);
  fs.writeFileSync(path.join(mainDir, "manifest.json"), `${JSON.stringify(mainPageManifest, null, 2)}\n`);

  const outDir = path.resolve("com.charlesbine.t3-deck.sdPlugin/profiles");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "t3-deck-plus.streamDeckProfile");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  execFileSync("zip", ["-rq", outPath, "package.json", "Profiles"], { cwd: tmpDir });
  console.log("Built bundled profile:", outPath);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
