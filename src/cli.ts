#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { argv, cwd, exit, stdin, stdout } from "node:process";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import kleur from "kleur";

import { lex, Parser, Token, Visitor } from "./lang.ts";
import { execnilad, Val } from "./util.ts";
import pretty from "./pretty.ts";
import { quadsList } from "./quads.ts";

import keyboard from "./keyboard.json" with { type: "json" };
const keymap = keyboard as Record<string, string>;

import pkg from "../package.json" with { type: "json" };
const verStr = `FIXAPL v${pkg.version}`;

const fmt = (s: string) =>
  lex(s)
    .map((x) => x.image)
    .join("")
    .trimEnd();
const bdg: Record<string, number> = {};
const highlight = (tks: Token[]) =>
  tks
    .map(({ kind, image }) => {
      let style = kleur.white;
      const ba = kind === "identifier" ? (bdg[image] ?? 0) : 0;
      const qa = kind === "quad" ? (quadsList.get(image.slice(1)) ?? 0) : 0;
      if (kind === "monadic function" || ba === 1 || qa === 1)
        style = kleur.green;
      if (kind === "dyadic function" || ba === 2 || qa === 2)
        style = kleur.blue;
      if (kind === "monadic modifier") style = kleur.yellow;
      if (kind === "dyadic modifier") style = kleur.magenta;
      if (kind === "string" || kind === "character") style = kleur.cyan;
      if (kind === "number" || kind === "constant" || kind.includes("dfn arg"))
        style = kleur.red;
      if (kind === "comment") style = kleur.gray().italic;
      return style(image);
    })
    .join("");
let root = cwd();
// create readline interface
const rl = readline.createInterface({
  input: stdin,
  output: stdout,
  terminal: true,
  prompt: "".padEnd(8),
}) as any;
rl.on('SIGINT', () => { exit(1) });
// handle tab-prefix mappings
let tabEntered = false;
const origTtyWrite = rl._ttyWrite.bind(rl);
function replTtyWrite(ch: string, key: any) {
  if (tabEntered) {
    tabEntered = false;
    if (ch in keymap) {
      ch = keymap[ch];
    }
  }
  else if (key?.name === "tab") {
    tabEntered = true;
    return;
  }
  return origTtyWrite(ch, key);
};
rl._ttyWrite = replTtyWrite
let lastWrite = "";
const v = new Visitor({
  write: (s) => {
    stdout.write(s);
    lastWrite = s;
  },
  read: () =>
    new Promise<string>((resolve) => {
      let lastLine = lastWrite.split("\n").at(-1);
      rl._ttyWrite = origTtyWrite;
      let saveHist = rl.history;
      rl.history = [];
      rl.question(lastLine, (answer: string) => {
        resolve(answer);
        rl._ttyWrite = replTtyWrite;
        rl.history = saveHist;
      })
    }),
  readFile: (p) => readFile(resolve(root, p), "utf8"),
});
async function run(s: string) {
  const t = lex(s).filter((t) => !"whitespace,comment".includes(t.kind));
  const p = new Parser(t).program();
  const o: Val[] = [];
  for (const x of p) o.push(await execnilad(await v.visit(x)));
  return o;
}

const read = (p: string) => readFile(resolve(cwd(), p), "utf8");

if (["-v", "--version"].includes(argv[2])) console.log(pkg.version);
else if (["-h", "--help", "help"].includes(argv[2])) {
  console.log(`${verStr}
${"-".repeat(verStr.length)}
REPL:    fixapl
run:     fixapl file.fxapl    or    fixapl run [file]
format:  fixapl fmt [file]
options: -h = --help, -v = --version
update:  npm i -g fixapl`);
} else if (argv[2] === "run" || argv[2]?.endsWith(".fxapl")) {
  const isRun = argv[2] === "run";
  const fileArg = isRun ? argv[3] : argv[2];
  if (fileArg) root = dirname(fileArg);
  await run(fileArg ? await read(fileArg) : await text(stdin));
  exit(0);
} else if (argv[2] === "fmt") {
  rl.close()
  if (!argv[3]) {
    stdout.write(fmt(await text(stdin)));
  } else {
    await writeFile(argv[3], fmt(await read(argv[3])) + "\n");
  }
} else {
  console.log(`${verStr} REPL\n^C to close`);
  rl.on('line', async (line: string) => {
    if (line.trim().length > 0) try {
      const tks = lex(line.trim());
      // replace input with formatted/highlighted code
      const o = Math.ceil(line.length / process.stdout.columns)
      readline.moveCursor(rl.output, 0, -o)
      rl.output.write(rl.getPrompt() + highlight(tks));
      readline.clearLine(rl.output, 1)
      rl.output.write("\n")
      // replace history with formatted line
      rl.history[0] = tks.map((k) => k.image).join("");
      // filter executable code
      const c = tks.filter((t) => !"whitespace,comment".includes(t.kind));
      if (c.length !== 0) {
        const x = new Parser(c).program()[0];
        const r = await v.visit(x);
        if (x.kind === "binding") {
          bdg[x.name] = r.kind === "function" ? r.arity : 0;
        } else {
          const out = await pretty(await execnilad(r));
          rl.output.write(out.join("\n") + "\n");
        }
      }
    } catch (e) {
      console.error(kleur.red(e instanceof Error ? e.message : e + ""));
    }
    rl.prompt()
  });
  rl.prompt()
}
