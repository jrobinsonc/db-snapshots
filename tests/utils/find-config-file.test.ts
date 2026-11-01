import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UserError } from "../../src/utils/exceptions";
import {
  CONFIG_FILE_NAME,
  findConfigFile,
} from "../../src/utils/find-config-file";

describe("utils/findConfigFile", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dbs-")));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("it finds the config in the start directory", () => {
    const config = path.join(root, CONFIG_FILE_NAME);
    fs.writeFileSync(config, "{}");

    expect(findConfigFile(root)).toEqual(config);
  });

  test("it finds the config from a nested subdirectory", () => {
    const config = path.join(root, CONFIG_FILE_NAME);
    const nested = path.join(root, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(config, "{}");

    expect(findConfigFile(nested)).toEqual(config);
  });

  test("it prefers the nearest config", () => {
    const nested = path.join(root, "a");
    const nearest = path.join(nested, CONFIG_FILE_NAME);
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(root, CONFIG_FILE_NAME), "{}");
    fs.writeFileSync(nearest, "{}");

    expect(findConfigFile(nested)).toEqual(nearest);
  });

  test("it throws a config_not_found user error when none exists", () => {
    try {
      findConfigFile(root);
      throw new Error("expected findConfigFile to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UserError);
      expect((error as UserError).code).toEqual("config_not_found");
      expect((error as UserError).message).toContain("dbs init");
    }
  });
});
