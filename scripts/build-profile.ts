import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_UUID = "com.charlesbine.t3-deck";
const PLUGIN_META = {
  Name: "T3 Deck",
  UUID: PLUGIN_UUID,
  Version: "1.2.0.0"
};

interface ActionDef {
  name: string;
  uuid: string;
  settings?: Record<string, unknown>;
  plugin?: { Name: string; UUID: string; Version: string };
}

interface PageSpec {
  pageUuid: string;
  keypad: Record<string, ActionDef>;
  encoder?: Record<string, ActionDef>;
}

interface DeviceProfileSpec {
  fileName: string;
  profileName: string;
  deviceModel: string;
  deviceUuid: string;
  profileUuid: string;
  defaultPageUuid: string;
  hasEncoder: boolean;
  pages: PageSpec[];
}

const A = {
  fleet: { name: "Fleet Pulse", uuid: `${PLUGIN_UUID}.fleet-attention` },
  approve: { name: "Approve / Answer", uuid: `${PLUGIN_UUID}.approve` },
  stop: { name: "Stop / Deny", uuid: `${PLUGIN_UUID}.stop-deny` },
  settle: { name: "Settle / Pin", uuid: `${PLUGIN_UUID}.settle-pin` },
  newChat: { name: "New Chat", uuid: `${PLUGIN_UUID}.new-thread` },
  prompt: (label = "CONTINUE", prompt = "Continue"): ActionDef => ({
    name: "Send / Steer Prompt",
    uuid: `${PLUGIN_UUID}.quick-prompt`,
    settings: { label, prompt, mode: "auto" }
  }),
  open: { name: "Open Thread / PR", uuid: `${PLUGIN_UUID}.open-thread` },
  snooze: { name: "Snooze / Sync", uuid: `${PLUGIN_UUID}.snooze-sync` },
  slot: { name: "Thread Slot", uuid: `${PLUGIN_UUID}.thread-slot` },
  thread: { name: "Thread Navigator", uuid: `${PLUGIN_UUID}.thread-dial` },
  model: { name: "Model & Provider", uuid: `${PLUGIN_UUID}.model-dial` },
  mode: { name: "Mode & Effort", uuid: `${PLUGIN_UUID}.mode-dial` },
  usage: { name: "Usage Radar", uuid: `${PLUGIN_UUID}.usage-dial` },
  nextPage: {
    name: "Next Page",
    uuid: "com.elgato.streamdeck.page.next",
    plugin: { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" }
  },
  prevPage: {
    name: "Previous Page",
    uuid: "com.elgato.streamdeck.page.previous",
    plugin: { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" }
  }
};

function makeAction(actionId: string, def: ActionDef) {
  return {
    ActionID: actionId,
    LinkedTitle: false,
    Name: def.name,
    Plugin: def.plugin ?? PLUGIN_META,
    Resources: null,
    Settings: def.settings ?? {},
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
    UUID: def.uuid
  };
}

function deterministicActionId(prefixHex: string, seq: number): string {
  const suffix = seq.toString(16).padStart(4, "0");
  return `6b7a9e42-3d4f-4e91-${prefixHex}-73d3c4e1${suffix}`;
}

function buildActionMap(prefixHex: string, entries: Record<string, ActionDef>, offset = 1) {
  const out: Record<string, ReturnType<typeof makeAction>> = {};
  let seq = offset;
  for (const [coord, def] of Object.entries(entries)) {
    out[coord] = makeAction(deterministicActionId(prefixHex, seq++), def);
  }
  return out;
}

function core8Keypad(): Record<string, ActionDef> {
  return {
    "0,0": A.fleet,
    "1,0": A.approve,
    "2,0": A.stop,
    "3,0": A.settle,
    "0,1": A.newChat,
    "1,1": A.prompt("CONTINUE", "Continue"),
    "2,1": A.open,
    "3,1": A.snooze
  };
}

// 1. Stream Deck+ (4x2 + 4 dials)
const plusSpec: DeviceProfileSpec = {
  fileName: "t3-deck-plus.streamDeckProfile",
  profileName: "T3 Deck",
  deviceModel: "20GBD9901",
  deviceUuid: "6b7a9e42-3d4f-4e91-8a55-73d3c4e10000",
  profileUuid: "6B7A9E42-3D4F-4E91-8A55-73D3C4E10001",
  defaultPageUuid: "6B7A9E42-3D4F-4E91-8A55-73D3C4E10002",
  hasEncoder: true,
  pages: [
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A55-73D3C4E10003",
      keypad: core8Keypad(),
      encoder: {
        "0,0": A.thread,
        "1,0": A.model,
        "2,0": A.mode,
        "3,0": A.usage
      }
    }
  ]
};

// 2. Stream Deck+ XL (9x4 + 6 dials)
function plusXlKeypad(): Record<string, ActionDef> {
  const map: Record<string, ActionDef> = {
    ...core8Keypad(),
    // Row 2 cols 0..3: 4 dev workflow quick-prompts
    "0,2": A.prompt("RUN TESTS", "Run the full test suite and fix any failures."),
    "1,2": A.prompt("COMMIT & PR", "Commit these changes with a clear message and open a PR."),
    "2,2": A.prompt("REVIEW DIFF", "Review your git diff critically and check for edge cases."),
    "3,2": A.prompt("FIX CI", "Inspect the failing CI checks and fix them."),
    // Row 3 cols 0..3: 4 extra one-tap prompts (no redundancy with Dials 1..4 right below!)
    "0,3": A.prompt("IMPLEMENT", "Implement the proposed plan cleanly."),
    "1,3": A.prompt("EXPLAIN", "Explain what you changed and why, concisely."),
    "2,3": A.prompt("FIX TYPES", "Run typecheck and fix any TypeScript errors."),
    "3,3": A.prompt("STATUS", "Give me a quick status summary of what's done and what's left.")
  };
  // Right 5x4 Fleet Wall (cols 4..8, rows 0..3 = 20 live Thread Slots!)
  for (let row = 0; row < 4; row++) {
    for (let col = 4; col < 9; col++) {
      map[`${col},${row}`] = A.slot;
    }
  }
  return map;
}

const plusXlSpec: DeviceProfileSpec = {
  fileName: "t3-deck-plus-xl.streamDeckProfile",
  profileName: "T3 Deck (+ XL)",
  deviceModel: "20GBX9901",
  deviceUuid: "6b7a9e42-3d4f-4e91-8a60-73d3c4e10000",
  profileUuid: "6B7A9E42-3D4F-4E91-8A60-73D3C4E10001",
  defaultPageUuid: "6B7A9E42-3D4F-4E91-8A60-73D3C4E10002",
  hasEncoder: true,
  pages: [
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A60-73D3C4E10003",
      keypad: plusXlKeypad(),
      encoder: {
        "0,0": A.thread,
        "1,0": A.model,
        "2,0": A.mode,
        "3,0": A.usage,
        "4,0": A.prompt("CONTINUE", "Continue"),
        "5,0": A.snooze
      }
    }
  ]
};

// 3. Stream Deck / MK.2 (5x3 = 15 keys, no dials)
const mk2Spec: DeviceProfileSpec = {
  fileName: "t3-deck-mk2.streamDeckProfile",
  profileName: "T3 Deck (MK.2)",
  deviceModel: "20GAA9902",
  deviceUuid: "6b7a9e42-3d4f-4e91-8a61-73d3c4e10000",
  profileUuid: "6B7A9E42-3D4F-4E91-8A61-73D3C4E10001",
  defaultPageUuid: "6B7A9E42-3D4F-4E91-8A61-73D3C4E10002",
  hasEncoder: false,
  pages: [
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A61-73D3C4E10003",
      keypad: {
        ...core8Keypad(),
        "0,2": A.thread,
        "1,2": A.model,
        "2,2": A.mode,
        "3,2": A.usage,
        // Col 4: 3 live Thread Slots (#1, #2, #3)
        "4,0": A.slot,
        "4,1": A.slot,
        "4,2": A.slot
      }
    }
  ]
};

// 4. Stream Deck XL (8x4 = 32 keys, no dials)
function xlKeypad(): Record<string, ActionDef> {
  const map: Record<string, ActionDef> = {
    ...core8Keypad(),
    // Row 2 cols 0..3: Keypad Cockpit
    "0,2": A.thread,
    "1,2": A.model,
    "2,2": A.mode,
    "3,2": A.usage,
    // Row 3 cols 0..3: 4 Quick Prompt presets
    "0,3": A.prompt("RUN TESTS", "Run the full test suite and fix any failures."),
    "1,3": A.prompt("COMMIT & PR", "Commit these changes with a clear message and open a PR."),
    "2,3": A.prompt("REVIEW DIFF", "Review your git diff critically and check for edge cases."),
    "3,3": A.prompt("FIX CI", "Inspect the failing CI checks and fix them.")
  };
  // Right 4x4 Fleet Wall (cols 4..7, rows 0..3 = 16 live Thread Slots!)
  for (let row = 0; row < 4; row++) {
    for (let col = 4; col < 8; col++) {
      map[`${col},${row}`] = A.slot;
    }
  }
  return map;
}

const xlSpec: DeviceProfileSpec = {
  fileName: "t3-deck-xl.streamDeckProfile",
  profileName: "T3 Deck (XL)",
  deviceModel: "20GAT9902",
  deviceUuid: "6b7a9e42-3d4f-4e91-8a62-73d3c4e10000",
  profileUuid: "6B7A9E42-3D4F-4E91-8A62-73D3C4E10001",
  defaultPageUuid: "6B7A9E42-3D4F-4E91-8A62-73D3C4E10002",
  hasEncoder: false,
  pages: [
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A62-73D3C4E10003",
      keypad: xlKeypad()
    }
  ]
};

// 5. Stream Deck Neo (4x2 = 8 keys, 2 pages accessible via built-in Neo touch points!)
const neoSpec: DeviceProfileSpec = {
  fileName: "t3-deck-neo.streamDeckProfile",
  profileName: "T3 Deck (Neo)",
  deviceModel: "20GBJ9901",
  deviceUuid: "6b7a9e42-3d4f-4e91-8a63-73d3c4e10000",
  profileUuid: "6B7A9E42-3D4F-4E91-8A63-73D3C4E10001",
  defaultPageUuid: "6B7A9E42-3D4F-4E91-8A63-73D3C4E10002",
  hasEncoder: false,
  pages: [
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A63-73D3C4E10003",
      keypad: core8Keypad()
    },
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A63-73D3C4E10004",
      keypad: {
        "0,0": A.thread,
        "1,0": A.model,
        "2,0": A.mode,
        "3,0": A.usage,
        "0,1": A.slot,
        "1,1": A.slot,
        "2,1": A.slot,
        "3,1": A.slot
      }
    }
  ]
};

// 6. Stream Deck Mini (3x2 = 6 keys, 2 pages with built-in Elgato Next/Prev Page buttons!)
const miniSpec: DeviceProfileSpec = {
  fileName: "t3-deck-mini.streamDeckProfile",
  profileName: "T3 Deck (Mini)",
  deviceModel: "20GAI9901",
  deviceUuid: "6b7a9e42-3d4f-4e91-8a64-73d3c4e10000",
  profileUuid: "6B7A9E42-3D4F-4E91-8A64-73D3C4E10001",
  defaultPageUuid: "6B7A9E42-3D4F-4E91-8A64-73D3C4E10002",
  hasEncoder: false,
  pages: [
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A64-73D3C4E10003",
      keypad: {
        "0,0": A.fleet,
        "1,0": A.approve,
        "2,0": A.stop,
        "0,1": A.thread,
        "1,1": A.model,
        "2,1": A.nextPage
      }
    },
    {
      pageUuid: "6B7A9E42-3D4F-4E91-8A64-73D3C4E10004",
      keypad: {
        "0,0": A.newChat,
        "1,0": A.prompt("CONTINUE", "Continue"),
        "2,0": A.mode,
        "0,1": A.snooze,
        "1,1": A.usage,
        "2,1": A.prevPage
      }
    }
  ]
};

const ALL_PROFILES: DeviceProfileSpec[] = [
  plusSpec,
  plusXlSpec,
  mk2Spec,
  xlSpec,
  neoSpec,
  miniSpec
];

function buildProfileArchive(spec: DeviceProfileSpec, outDir: string): void {
  const emptyControllers = spec.hasEncoder
    ? [
        { Actions: null, Type: "Keypad" },
        { Actions: null, Type: "Encoder" }
      ]
    : [{ Actions: null, Type: "Keypad" }];

  const emptyPageManifest = {
    Controllers: emptyControllers,
    Icon: "",
    Name: ""
  };

  const profileManifest = {
    Device: {
      Model: spec.deviceModel,
      UUID: spec.deviceUuid
    },
    Name: spec.profileName,
    Pages: {
      Current: "00000000-0000-0000-0000-000000000000",
      Default: spec.defaultPageUuid.toLowerCase(),
      Pages: spec.pages.map((p) => p.pageUuid.toLowerCase())
    },
    Version: "3.0"
  };

  const packageMeta = {
    AppVersion: "7.5.0.22885",
    DeviceModel: spec.deviceModel,
    DeviceSettings: null,
    FormatVersion: 1,
    OSType: "macOS",
    OSVersion: "13.0",
    RequiredPlugins: [PLUGIN_UUID]
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-deck-profile-"));
  try {
    const profRoot = path.join(tmpDir, "Profiles", `${spec.profileUuid}.sdProfile`);
    const defaultDir = path.join(profRoot, "Profiles", spec.defaultPageUuid);
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "package.json"), `${JSON.stringify(packageMeta, null, 2)}\n`);
    fs.writeFileSync(
      path.join(profRoot, "manifest.json"),
      `${JSON.stringify(profileManifest, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(defaultDir, "manifest.json"),
      `${JSON.stringify(emptyPageManifest, null, 2)}\n`
    );

    const prefixHex = spec.deviceUuid.split("-")[3] ?? "8a55";
    spec.pages.forEach((page, pageIdx) => {
      const pageDir = path.join(profRoot, "Profiles", page.pageUuid);
      fs.mkdirSync(pageDir, { recursive: true });
      const controllers: Array<{ Actions: Record<string, unknown> | null; Type: string }> = [
        {
          Actions: buildActionMap(prefixHex, page.keypad, 0x0100 + pageIdx * 0x0100),
          Type: "Keypad"
        }
      ];
      if (spec.hasEncoder) {
        controllers.push({
          Actions: page.encoder
            ? buildActionMap(prefixHex, page.encoder, 0x0800 + pageIdx * 0x0100)
            : null,
          Type: "Encoder"
        });
      }
      const pageManifest = { Controllers: controllers, Icon: "", Name: "" };
      fs.writeFileSync(
        path.join(pageDir, "manifest.json"),
        `${JSON.stringify(pageManifest, null, 2)}\n`
      );
    });

    const outPath = path.join(outDir, spec.fileName);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    execFileSync("zip", ["-rq", outPath, "package.json", "Profiles"], { cwd: tmpDir });
    console.log("Built bundled profile:", outPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const outDir = path.resolve("com.charlesbine.t3-deck.sdPlugin/profiles");
fs.mkdirSync(outDir, { recursive: true });
for (const spec of ALL_PROFILES) {
  buildProfileArchive(spec, outDir);
}
