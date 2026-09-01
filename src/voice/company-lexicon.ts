import { spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

// Listed first so its explicit mappings win over aliases derived from the
// glossary when both produce the same spoken form.
const SPOKEN_ALIAS_FILE_NAME = "음성-별칭.md";

const REFERENCE_FILE_NAMES = [
  SPOKEN_ALIAS_FILE_NAME,
  "용어사전.md",
  "용어사전-상세.md",
  "조직구조.md",
  "조직구조-전직원.md",
  "제품구조.md",
  "과제목록.md"
] as const;

const FOR_AI_RELATIVE_DIRS = [
  ["공유문서", "연구소 생활", "for-ai"],
  ["연구소 생활", "for-ai"],
  ["for-ai"]
] as const;

const MAX_PROMPT_LENGTH = 1_800;
const MAX_PROMPT_TERMS = 80;
const MAX_PROMPT_PEOPLE = 32;

interface VoiceAlias {
  alias: string;
  target: string;
  source: string;
}

interface PersonRecord {
  name: string;
  context: string;
}

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

export interface CompanyTranscriptNormalization {
  text: string;
  replacementCount: number;
  referenceDirectory: string | null;
}

export class CompanyVoiceLexicon {
  private referenceDirectory: string | null | undefined;
  private referenceSignature = "";
  private aliases: VoiceAlias[] = [];
  private terms: string[] = [];
  private spokenAliasTargets: string[] = [];
  private people: PersonRecord[] = [];
  private leadershipPeople: PersonRecord[] = [];

  constructor(private readonly vaultRoot: string | null) {}

  buildTranscriptionPrompt(noteContext: string): string {
    this.ensureLoaded();
    const context = normalizePromptText(noteContext).slice(0, 500);
    const normalizedContext = normalizeLookupKey(context);
    const relevantTerms = normalizedContext
      ? this.terms.filter((term) => normalizedContext.includes(normalizeLookupKey(term)))
      : [];
    const relevantPeople = normalizedContext
      ? this.people.filter((person) => normalizedContext.includes(normalizeLookupKey(person.name)))
      : [];
    const priorityTerms = uniqueStrings([
      ...this.spokenAliasTargets,
      ...relevantTerms,
      ...this.terms
    ]).slice(0, MAX_PROMPT_TERMS);
    const priorityPeople = uniquePeople([
      ...relevantPeople,
      ...this.leadershipPeople
    ]).slice(0, MAX_PROMPT_PEOPLE);

    const sections: string[] = [];
    if (context) {
      sections.push(`현재 문서 문맥: ${context}`);
    }
    if (priorityTerms.length > 0) {
      sections.push(`표준 용어: ${priorityTerms.join(", ")}`);
    }
    if (priorityPeople.length > 0) {
      sections.push(`직원 이름과 소속: ${priorityPeople.map(formatPersonPrompt).join(", ")}`);
    }
    return sections.join("\n").slice(0, MAX_PROMPT_LENGTH);
  }

  normalizeTranscript(transcript: string): CompanyTranscriptNormalization {
    this.ensureLoaded();
    let text = transcript.normalize("NFC");
    let replacementCount = 0;

    for (const entry of this.aliases) {
      const pattern = createAliasPattern(entry.alias);
      if (!pattern) {
        continue;
      }
      text = text.replace(pattern, (match) => {
        if (match === entry.target) {
          return match;
        }
        replacementCount += 1;
        return entry.target;
      });
    }

    for (const person of this.people) {
      const pattern = createSpacedKoreanNamePattern(person.name);
      if (!pattern) {
        continue;
      }
      text = text.replace(pattern, (match) => {
        if (match === person.name) {
          return match;
        }
        replacementCount += 1;
        return person.name;
      });
    }

    return {
      text: text.replace(/[ \t]{2,}/g, " ").trim(),
      replacementCount,
      referenceDirectory: this.referenceDirectory ?? null
    };
  }

  private ensureLoaded() {
    const directory = this.resolveReferenceDirectory();
    const signature = getReferenceSignature(directory);
    if (signature === this.referenceSignature) {
      return;
    }

    this.referenceSignature = signature;
    this.aliases = [];
    this.terms = [];
    this.spokenAliasTargets = [];
    this.people = [];
    this.leadershipPeople = [];
    if (!directory) {
      this.sortAndDedupeAliases();
      return;
    }

    const documents = new Map<string, string>();
    for (const fileName of REFERENCE_FILE_NAMES) {
      const filePath = join(directory, fileName);
      if (!existsSync(filePath)) {
        continue;
      }
      try {
        documents.set(fileName, readFileSync(filePath, "utf8"));
      } catch {
        // A locked or temporarily syncing reference file must not block dictation.
      }
    }

    for (const [fileName, markdown] of documents) {
      if (fileName === SPOKEN_ALIAS_FILE_NAME) {
        this.extractSpokenAliases(markdown);
        continue;
      }
      if (fileName === "조직구조.md" || fileName === "조직구조-전직원.md") {
        const records = extractPeople(markdown);
        this.people.push(...records);
        if (fileName === "조직구조.md") {
          this.leadershipPeople.push(...records);
        }
      }
      this.extractTerms(fileName, markdown);
    }

    this.people = uniquePeople(this.people);
    this.leadershipPeople = uniquePeople(this.leadershipPeople);
    this.terms = uniqueStrings(this.terms);
    this.sortAndDedupeAliases();
  }

  /**
   * Reads the vault's spoken-form table: column 0 is what the transcriber hears,
   * column 1 is the canonical spelling to write instead.
   */
  private extractSpokenAliases(markdown: string) {
    for (const table of parseMarkdownTables(markdown)) {
      for (const row of table.rows) {
        const alias = normalizeTerm(row[0] ?? "");
        const target = normalizeTerm(row[1] ?? "");
        if (!isUsefulTerm(alias) || !target) {
          continue;
        }
        this.aliases.push({ alias, target, source: SPOKEN_ALIAS_FILE_NAME });
        this.addTerm(target, SPOKEN_ALIAS_FILE_NAME);
        this.spokenAliasTargets.push(target);
      }
    }
  }

  private extractTerms(fileName: string, markdown: string) {
    for (const table of parseMarkdownTables(markdown)) {
      const normalizedHeaders = table.headers.map(normalizeLookupKey);
      const internalNameIndex = normalizedHeaders.findIndex((header) => header.includes("사내호칭"));
      const taskNameIndex = normalizedHeaders.findIndex((header) => header === "과제명");
      const taskCodeIndex = normalizedHeaders.findIndex((header) => header === "과제코드");
      const candidateIndexes = new Set<number>();

      if (fileName.startsWith("용어사전") || fileName === "제품구조.md") {
        candidateIndexes.add(0);
      }
      if (taskNameIndex >= 0) {
        candidateIndexes.add(taskNameIndex);
      }
      if (taskCodeIndex >= 0) {
        candidateIndexes.add(taskCodeIndex);
      }

      for (const row of table.rows) {
        for (const index of candidateIndexes) {
          const term = normalizeTerm(row[index] ?? "");
          if (!isUsefulTerm(term)) {
            continue;
          }
          this.addTerm(term, fileName);
        }

        if (internalNameIndex >= 0) {
          const internalName = normalizeTerm(row[internalNameIndex] ?? "");
          if (isUsefulTerm(internalName)) {
            this.addTerm(internalName, fileName);
          }
        }
      }
    }
  }

  private addTerm(term: string, source: string) {
    this.terms.push(term);
    this.aliases.push({ alias: term, target: term, source });

    const withoutTrademark = term.replace(/[™®©]/g, "").trim();
    if (withoutTrademark && withoutTrademark !== term) {
      this.aliases.push({ alias: withoutTrademark, target: term, source });
    }

    for (const variant of createAsciiTermVariants(withoutTrademark || term)) {
      this.aliases.push({ alias: variant, target: term, source });
    }
  }

  private sortAndDedupeAliases() {
    const aliases = new Map<string, VoiceAlias>();
    for (const entry of this.aliases) {
      const alias = normalizePromptText(entry.alias);
      const target = normalizePromptText(entry.target);
      if (!isUsefulTerm(alias) || !target) {
        continue;
      }
      const key = alias.toLocaleLowerCase();
      if (!aliases.has(key)) {
        aliases.set(key, { ...entry, alias, target });
      }
    }
    this.aliases = [...aliases.values()]
      .sort((left, right) => right.alias.length - left.alias.length)
      .slice(0, 1_000);
  }

  private resolveReferenceDirectory(): string | null {
    if (this.referenceDirectory !== undefined) {
      return this.referenceDirectory;
    }

    const roots = uniquePaths([
      this.vaultRoot ?? "",
      process.env.OBST_VOICE_VAULT_PATH ?? "",
      process.env.OBST_INDEXER_VAULT ?? "",
      getDefaultObstIndexerVault()
    ]);
    for (const root of roots) {
      for (const relativeParts of FOR_AI_RELATIVE_DIRS) {
        const candidate = resolve(root, ...relativeParts);
        if (hasCompanyReferenceFiles(candidate)) {
          this.referenceDirectory = candidate;
          return candidate;
        }
      }
    }

    this.referenceDirectory = null;
    return null;
  }
}

function getDefaultObstIndexerVault(): string {
  const configCandidates = process.platform === "win32"
    ? [
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ObstIndexer", "config.json") : "",
        process.env.APPDATA ? join(process.env.APPDATA, "ObstIndexer", "config.json") : ""
      ]
    : [
        join(homedir(), ".config", "obst-indexer", "config.json"),
        join(homedir(), ".local", "share", "ObstIndexer", "config.json"),
        join(homedir(), "Library", "Application Support", "ObstIndexer", "config.json")
      ];
  for (const configPath of uniquePaths(configCandidates)) {
    if (!existsSync(configPath)) {
      continue;
    }
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        default_vault?: unknown;
        vault?: unknown;
      };
      const configuredVault = typeof config.default_vault === "string"
        ? config.default_vault
        : typeof config.vault === "string"
          ? config.vault
          : "";
      if (configuredVault.trim()) {
        return configuredVault.trim();
      }
    } catch {
      // Fall through to the CLI when a local config is from an older format.
    }
  }

  const commands = process.platform === "win32"
    ? ["obst-indexer.exe", "obst-indexer"]
    : ["obst-indexer"];
  for (const command of commands) {
    try {
      const result = spawnSync(command, ["status"], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const match = output.match(/^vault=(.+)$/m);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    } catch {
      // The indexer is optional; current-vault and user-home candidates remain.
    }
  }
  return "";
}

function hasCompanyReferenceFiles(directory: string): boolean {
  return existsSync(join(directory, "용어사전.md")) &&
    (existsSync(join(directory, "조직구조.md")) ||
      existsSync(join(directory, "조직구조-전직원.md")));
}

function getReferenceSignature(directory: string | null): string {
  if (!directory) {
    return "missing";
  }
  const values = REFERENCE_FILE_NAMES.map((fileName) => {
    const filePath = join(directory, fileName);
    if (!existsSync(filePath)) {
      return `${fileName}:missing`;
    }
    try {
      const stats = statSync(filePath);
      return `${fileName}:${stats.size}:${stats.mtimeMs}`;
    } catch {
      return `${fileName}:unreadable`;
    }
  });
  return `${directory}\0${values.join("|")}`;
}

function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableRow(lines[index]) || !isMarkdownSeparatorRow(lines[index + 1])) {
      continue;
    }
    const headers = parseMarkdownTableRow(lines[index]);
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && isMarkdownTableRow(lines[index])) {
      rows.push(parseMarkdownTableRow(lines[index]));
      index += 1;
    }
    index -= 1;
    tables.push({ headers, rows });
  }
  return tables;
}

function isMarkdownTableRow(line: string): boolean {
  const value = line.trim();
  return value.startsWith("|") && value.endsWith("|") && value.length > 2;
}

function isMarkdownSeparatorRow(line: string): boolean {
  if (!isMarkdownTableRow(line)) {
    return false;
  }
  return parseMarkdownTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function parseMarkdownTableRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map(normalizeTerm);
}

function extractPeople(markdown: string): PersonRecord[] {
  const records: PersonRecord[] = [];
  let section = "";
  for (const line of markdown.split(/\r?\n/)) {
    const sectionMatch = line.match(/^###\s+(.+?)\s*$/);
    if (sectionMatch) {
      section = normalizePromptText(sectionMatch[1]);
    }

    const rosterMatch = line.match(/^\s*-\s+\*\*([가-힣]{3,4})\*\*\s*(.*)$/);
    if (rosterMatch) {
      const details = normalizePromptText(rosterMatch[2])
        .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "")
        .replace(/\|\s*업무:.*$/i, "")
        .replace(/\s*\/\s*/g, " ")
        .trim();
      records.push({
        name: rosterMatch[1],
        context: normalizePromptText([rosterMatch[1], details, section].filter(Boolean).join(" "))
      });
    }
  }

  const leadershipPattern = /(?:회장|총괄장|연구소장|실장|센터장|그룹장|랩장|팀장)\s*:\s*([가-힣]{3,4})(?:\s+([가-힣A-Za-z]+))?/g;
  for (const match of markdown.matchAll(leadershipPattern)) {
    records.push({
      name: match[1],
      context: normalizePromptText(`${match[1]} ${match[2] ?? ""}`)
    });
  }
  return records;
}

function createAsciiTermVariants(term: string): string[] {
  if (!/[A-Za-z]/.test(term)) {
    return [];
  }
  const variants: string[] = [];
  const camelSpaced = term
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (camelSpaced !== term) {
    variants.push(camelSpaced);
  }
  if (/^[A-Z0-9-]{3,8}$/.test(term)) {
    variants.push(term.replace(/-/g, "").split("").join(" "));
  }
  return uniqueStrings(variants);
}

function createAliasPattern(alias: string): RegExp | null {
  const tokens = alias.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const body = tokens.map(escapeRegExp).join("[ \\t]+");
  const trailingBoundary = "(?=$|[^A-Za-z0-9가-힣]|(?:으로|에서|에게|까지|부터|처럼|보다|은|는|이|가|을|를|와|과|의|도|에|로|께|만)(?=[^가-힣]|$))";
  return new RegExp(`(?<![A-Za-z0-9가-힣])${body}${trailingBoundary}`, "giu");
}

function createSpacedKoreanNamePattern(name: string): RegExp | null {
  if (!/^[가-힣]{3,4}$/.test(name)) {
    return null;
  }
  const body = [...name].map(escapeRegExp).join("[ \\t]*");
  return new RegExp(`(?<![가-힣])${body}(?![가-힣])`, "gu");
}

function normalizeTerm(value: string): string {
  return normalizePromptText(value
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label: string) => label || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/[*_`~]/g, "")
    .replace(/&nbsp;/gi, " "));
}

function normalizePromptText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeLookupKey(value: string): string {
  return normalizePromptText(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function isUsefulTerm(value: string): boolean {
  if (!value || value.length < 3 || value.length > 100) {
    return false;
  }
  if (/^(?:용어|정의|비고|구분|과제명|과제코드|확인 필요|-+|\d+)$/i.test(value)) {
    return false;
  }
  return /[A-Za-z가-힣]/.test(value);
}

function formatPersonPrompt(person: PersonRecord): string {
  return person.context || person.name;
}

function uniquePeople(values: PersonRecord[]): PersonRecord[] {
  const result = new Map<string, PersonRecord>();
  for (const value of values) {
    if (!result.has(value.name)) {
      result.set(value.name, value);
    }
  }
  return [...result.values()];
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizePromptText(value);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function uniquePaths(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const path = value.trim();
    const key = process.platform === "win32" ? path.toLocaleLowerCase() : path;
    if (!path || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(path);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
