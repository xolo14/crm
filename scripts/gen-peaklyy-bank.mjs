import fs from "fs";

const src = fs.readFileSync(
  "c:/Users/nages/Downloads/crm-main/crm-main/peaklyy_doc_extract.txt",
  "utf8"
);
const lines = src.split(/\r?\n/).map((l) => l.replace(/\uFFFD/g, "").trim());

const DOMAIN_ORDER = [
  ["python", "IT & Development - Python"],
  ["javascript", "IT & Development - JavaScript"],
  ["html_css", "IT & Development - HTML & CSS"],
  ["java", "IT & Development - Java"],
  ["ui_design", "Design & Creation - UI Design"],
  ["writing_translation", "Writing & Translation"],
  ["business_finance", "Business & Finance"],
  ["digital_marketing", "Digital Marketing"],
  ["data_analytics", "Data Analytics"],
  ["video_animation", "Video & Animation"],
  ["photography", "Photography"],
];

function phpStr(s) {
  return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

const answerStart = lines.findIndex((l) => /^Answer Key/i.test(l));
const body = lines.slice(0, answerStart === -1 ? lines.length : answerStart);
const keyLines = answerStart === -1 ? [] : lines.slice(answerStart);

const DOMAIN_HEADER =
  /^(\d+)\.\s+(IT & Development|Design & Creation|Writing & Translation|Business & Finance|Digital Marketing|Data Analytics|Video & Animation|Photography)\b/i;

const domainStarts = [];
for (let i = 0; i < body.length; i++) {
  if (DOMAIN_HEADER.test(body[i])) domainStarts.push(i);
}

function parseMcqs(chunk) {
  const qs = [];
  for (let i = 0; i < chunk.length; i++) {
    const m = chunk[i].match(/^(\d+)\.\s+(.+)/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 15) continue;
    const prompt = m[2].trim();
    if (DOMAIN_HEADER.test(chunk[i])) continue;
    if (/^Section\s/i.test(prompt)) continue;
    const opts = {};
    for (let j = i + 1; j < chunk.length; j++) {
      if (/^\d+\.\s+/.test(chunk[j])) break;
      const om = chunk[j].match(/^([A-D])\)\s*(.*)$/);
      if (om) opts[om[1].toLowerCase()] = om[2].trim();
      if (opts.a && opts.b && opts.c && opts.d) break;
    }
    if (opts.a && opts.b && opts.c && opts.d) qs.push({ n, prompt, opts });
  }
  return qs.sort((a, b) => a.n - b.n);
}

function parseTask(chunk) {
  const idx = chunk.findIndex((l) => /Very Basic Practical Task/i.test(l));
  if (idx === -1) return "";
  for (let i = idx + 1; i < chunk.length; i++) {
    if (/^Expected outcome/i.test(chunk[i])) continue;
    if (chunk[i]) {
      return chunk[i]
        .replace(/â‚¹/g, "₹")
        .replace(/â€“/g, "–")
        .replace(/â€”/g, "—");
    }
  }
  return "";
}

const domains = {};
for (let d = 0; d < domainStarts.length; d++) {
  const start = domainStarts[d];
  const end = d + 1 < domainStarts.length ? domainStarts[d + 1] : body.length;
  const key = DOMAIN_ORDER[d][0];
  const chunk = body.slice(start, end);
  domains[key] = { mcqs: parseMcqs(chunk), task: parseTask(chunk) };
}

const answers = {};
let currentKey = null;
for (const line of keyLines) {
  const headerMatch = line.match(DOMAIN_HEADER);
  if (headerMatch) {
    const i = Number(headerMatch[1]) - 1;
    if (i >= 0 && i < DOMAIN_ORDER.length) {
      currentKey = DOMAIN_ORDER[i][0];
      answers[currentKey] = {};
    }
  }
  if (!currentKey) continue;
  const re = /(\d+)\.\s*([A-Da-d])/g;
  let m;
  while ((m = re.exec(line))) {
    answers[currentKey][Number(m[1])] = m[2].toLowerCase();
  }
}

let errors = [];
for (const [key] of DOMAIN_ORDER) {
  const d = domains[key];
  if (!d) {
    errors.push("missing domain " + key);
    continue;
  }
  if (d.mcqs.length !== 15) errors.push(key + " mcq count " + d.mcqs.length);
  if (!d.task) errors.push(key + " missing task");
  const a = answers[key] || {};
  for (let n = 1; n <= 15; n++) {
    if (!a[n]) errors.push(key + " missing answer " + n);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

let php = `<?php
/**
 * Peaklyy beginner-friendly student assessment bank.
 * 11 domains × (15 MCQs + 1 very basic practical task).
 * Source: Peaklyy_Beginner_Friendly_Student_Assessment.docx
 * Bank version: beginner_11x15_task_v1
 * Per attempt: all 15 domain MCQs + 1 domain task (untimed).
 */
function peaklyyQuestionBankVersion(): string
{
    return 'beginner_11x15_task_v1';
}

function peaklyyDomainMcqCount(): int
{
    return 15;
}

function peaklyyDomainTaskCount(): int
{
    return 1;
}

function peaklyyDomainQuestionCount(): int
{
    return peaklyyDomainMcqCount() + peaklyyDomainTaskCount();
}

function peaklyyDomainCatalog(): array
{
    return [
`;
for (const [k, label] of DOMAIN_ORDER) {
  php += `        ${phpStr(k)} => ${phpStr(label)},\n`;
}
php += `    ];
}

function peaklyyDegreeOptions(): array
{
    return [
        'B.Tech / BE - CSE',
        'B.Tech / BE - IT',
        'B.Tech / BE - Other',
        'BCA',
        'MCA',
        'B.Sc / M.Sc',
        'MBA / BBA',
        'Other',
    ];
}

/** @return list<array<string,mixed>> */
function peaklyyQuestionDefinitions(): array
{
    $q = [];

`;

for (const [key, label] of DOMAIN_ORDER) {
  php += `    // ── ${label} ──\n`;
  const d = domains[key];
  for (const q of d.mcqs) {
    const ans = answers[key][q.n];
    const opts =
      `['a' => ${phpStr(q.opts.a)}, 'b' => ${phpStr(q.opts.b)}, 'c' => ${phpStr(q.opts.c)}, 'd' => ${phpStr(q.opts.d)}]`;
    php += `    $q[] = [${phpStr(key)}, 'easy', 'mcq', ${phpStr(q.prompt)}, ${opts}, ${phpStr(ans)}, null, 1];\n`;
  }
  php += `\n`;
}

php += `    $task = static function (string $domain, string $prompt) {
        return [$domain, 'task', 'task', $prompt, null, null, null, 0];
    };

`;
for (const [key, label] of DOMAIN_ORDER) {
  php += `    $q[] = $task(${phpStr(key)}, ${phpStr(domains[key].task)});\n`;
}

php += `
    $out = [];
    $i = 0;
    foreach ($q as $row) {
        $i++;
        $out[] = [
            'domain_key' => $row[0],
            'level_key' => $row[1],
            'q_type' => $row[2],
            'prompt' => $row[3],
            'options' => $row[4],
            'correct_option' => $row[5],
            'task_schema' => $row[6],
            'points' => $row[7],
            'sort_order' => $i,
        ];
    }
    return $out;
}
`;

const out = "c:/Users/nages/Downloads/crm-main/crm-main/public/api/lib/PeaklyyQuestions.php";
fs.writeFileSync(out, php);
console.log("wrote", out, "defs", DOMAIN_ORDER.length * 16);
for (const [k] of DOMAIN_ORDER) {
  console.log(k, domains[k].task.slice(0, 70));
}
