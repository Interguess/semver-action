import * as core from "@actions/core";
import { exec } from "@actions/exec";

type Semver = { major: number; minor: number; patch: number };

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
function parseSemver(tag: string | undefined | null): Semver | null {
  if (!tag) return null;
  const m = tag.trim().match(SEMVER_RE);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

async function tagExists(tag: string): Promise<boolean> {
  let exitCode = 0;
  try {
    exitCode = await exec("git", ["rev-parse", `refs/tags/${tag}`], {
      silent: true,
    });
  } catch {
    return false;
  }
  return exitCode === 0;
}

function normalizeUpgradeType(x: string | undefined): "MAJOR" | "MINOR" | "PATCH" {
  const up = (x || "PATCH").trim().toUpperCase();
  return (up === "MAJOR" || up === "MINOR") ? up : "PATCH";
}

function formatSemver(s: Semver): string {
  return `${s.major}.${s.minor}.${s.patch}`;
}

async function bumpForUniqueness(version: string, bumpPatch: (v: string) => string): Promise<string> {
  let v = version;
  while (await tagExists(v)) {
    v = bumpPatch(v);
  }
  return v;
}

async function run(): Promise<void> {
  try {
    const baseBranch = core.getInput("baseBranch", { required: true }).trim();
    const upgradeType = normalizeUpgradeType(core.getInput("upgradeType"));

    const lastTag = core.getInput("lastTag"); // for main
    const lastMainTag = core.getInput("lastMainTag"); // for develop
    const lastDevelopTag = core.getInput("lastDevelopTag"); // for develop

    core.info(`Using baseBranch='${baseBranch}'`);
    core.info(`Using upgradeType='${upgradeType}'`);
    if (baseBranch === "main") {
      core.info(`Using lastTag='${lastTag}'`);
      const parsed = parseSemver(lastTag) ?? { major: 0, minor: 1, patch: 0 };
      if (!parseSemver(lastTag)) {
        core.info("No existing main tag found, starting with 0.1.0");
      } else {
        core.info(`Parsed existing main tag: ${formatSemver(parsed)}`);
      }

      let next: Semver = { ...parsed };
      switch (upgradeType) {
        case "MAJOR":
          next.major += 1; next.minor = 0; next.patch = 0; break;
        case "MINOR":
          next.minor += 1; next.patch = 0; break;
        default:
          next.patch += 1; break;
      }
      let newVersion = formatSemver(next);

      // ensure uniqueness; if exists, keep patch++ until free
      newVersion = await bumpForUniqueness(newVersion, (v) => {
        const m = v.match(SEMVER_RE)!;
        const p = +m[3] + 1;
        return `${m[1]}.${m[2]}.${p}`;
      });

      core.setOutput("version", newVersion);
      core.exportVariable("NEW_VERSION", newVersion);
      core.info(`NEW_VERSION=${newVersion}`);
      return;
    }

    // develop or any non-main branch
    core.info(`Using lastMainTag='${lastMainTag}'`);
    core.info(`Using lastDevelopTag='${lastDevelopTag}'`);

    const mainBase = parseSemver(lastMainTag) ?? { major: 0, minor: 1, patch: 0 };
    const baseVersion = formatSemver(mainBase);
    if (!parseSemver(lastMainTag)) {
      core.info("No main tag found, using base: 0.1.0");
    } else {
      core.info(`Using main tag as base: ${baseVersion}`);
    }

    // build number from lastDevelopTag if matching base
    let build = 0;
    const devPattern = new RegExp(`^${mainBase.major}\\.${mainBase.minor}\\.${mainBase.patch}-develop\\.(\\d+)$`);
    const m = (lastDevelopTag || "").trim().match(devPattern);
    if (m) {
      build = +m[1];
      core.info(`Found existing build number: ${build}`);
    } else {
      core.info("No matching develop tag found, starting build at 0");
    }
    build += 1;

    const mk = (b: number) => `${baseVersion}-develop.${b}`;
    let newVersion = mk(build);

    // ensure uniqueness by increasing build until tag is free
    newVersion = await bumpForUniqueness(newVersion, (v) => {
      const x = v.match(/^(.+?-develop\.)(\d+)$/)!;
      return `${x[1]}${+x[2] + 1}`;
    });

    core.setOutput("version", newVersion);
    core.exportVariable("NEW_VERSION", newVersion);
    core.info(`NEW_VERSION=${newVersion}`);
  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();
