import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const README_FILES = [
  "README.md",
  path.join("profile", "README.md"),
];

const SECTION_START = "<!-- top-favoritados:start -->";
const SECTION_END = "<!-- top-favoritados:end -->";
const ORG_LOGIN = process.env.ORG_LOGIN ?? "maua-edu";
const SHOWCASE_TOPIC = process.env.SHOWCASE_TOPIC ?? "imt-showcase";
const TOP_REPOSITORIES_LIMIT = 3;
const REPOSITORY_SEARCH_LIMIT = 100;
const IS_DRY_RUN = process.argv.includes("--dry-run");

const podium = [
  { icon: "🥇", message: "1º lugar", color: "C69214", title: "Primeiro lugar" },
  { icon: "🥈", message: "2º lugar", color: "94A3B8", title: "Segundo lugar" },
  { icon: "🥉", message: "3º lugar", color: "B45309", title: "Terceiro lugar" },
];

async function main() {
  const repositories = await getShowcaseRepositories();
  const section = renderSection(repositories.slice(0, TOP_REPOSITORIES_LIMIT));

  if (IS_DRY_RUN) {
    process.stdout.write(section);
    return;
  }

  await Promise.all(
    README_FILES.map(async (file) => {
      const absolutePath = path.resolve(file);
      const original = await readFile(absolutePath, "utf8");
      const updated = replaceSection(original, section);

      if (updated !== original) {
        await writeFile(absolutePath, updated, "utf8");
      }
    }),
  );
}

async function getShowcaseRepositories() {
  if (process.env.TOP_FAVORITES_FIXTURE) {
    const fixturePath = path.resolve(process.env.TOP_FAVORITES_FIXTURE);
    const fixture = await readFile(fixturePath, "utf8");
    return JSON.parse(fixture.replace(/^\uFEFF/, ""));
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "Defina GITHUB_TOKEN ou TOP_FAVORITES_FIXTURE para atualizar o ranking automaticamente.",
    );
  }

  const query = [
    `org:${ORG_LOGIN}`,
    `topic:${SHOWCASE_TOPIC}`,
    "archived:false",
    "fork:false",
    "is:public",
  ].join(" ");

  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(REPOSITORY_SEARCH_LIMIT));

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": `${ORG_LOGIN}-top-favorites-updater`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Falha ao buscar repositórios em destaque (${response.status} ${response.statusText}): ${body}`,
    );
  }

  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

function replaceSection(content, section) {
  const startIndex = content.indexOf(SECTION_START);
  const endIndex = content.indexOf(SECTION_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Marcadores da seção Top mais favoritados não foram encontrados.");
  }

  const before = content.slice(0, startIndex);
  const after = content.slice(endIndex + SECTION_END.length);

  return `${before}${section}${after}`;
}

function renderSection(repositories) {
  const generatedAt = formatDateTime(new Date());
  const cells = podium.map((place, index) => {
    const repository = repositories[index];
    return repository ? renderRepositoryCell(repository, place) : renderPlaceholderCell(place);
  });

  return [
    SECTION_START,
    `<!-- Maintainers: a automação considera os repositórios públicos marcados com a topic "${SHOWCASE_TOPIC}". -->`,
    "<table>",
    "  <tr>",
    cells.join("\n"),
    "  </tr>",
    "</table>",
    "",
    SECTION_END,
  ].join("\n");
}

function renderRepositoryCell(repository, place) {
  const name = escapeHtml(repository.name);
  const url = escapeHtml(repository.html_url);
  const description = escapeHtml(getDescription(repository.description));
  const language = escapeHtml(repository.language ?? "Multidisciplinar");
  const stars = formatCount(repository.stargazers_count);
  const forks = formatCount(repository.forks_count);
  const updatedAt = escapeHtml(formatDate(repository.pushed_at ?? repository.updated_at));

  return [
    `    <td width="33%" align="center" valign="top">`,
    `      ${renderBadge(place.icon, place.message, place.color, place.title)}`,
    `      <h3><a href="${url}">${name}</a></h3>`,
    `      <p>${description}</p>`,
    "      <p>",
    `        ${renderMetricBadge("Stars", stars, "C69214", "Total de estrelas")}`,
    `        ${renderMetricBadge("Forks", forks, "475569", "Total de forks")}`,
    `        ${renderMetricBadge("Atualizado", updatedAt, "0F4C81", "Última atualização")}`,
    "      </p>",
    "      <p>",
    `        ${renderMetricBadge("Stack", language, "0B6E4F", "Linguagem principal")}`,
    "      </p>",
    "    </td>",
  ].join("\n");
}

function renderPlaceholderCell(place) {
  return [
    `    <td width="33%" align="center" valign="top">`,
    `      ${renderBadge(place.icon, place.message, place.color, place.title)}`,
    "      <h3>Em atualização</h3>",
    "      <p>Este espaço será preenchido automaticamente assim que um novo destaque da vitrine for publicado.</p>",
    "      <p><code>⭐ stars</code> <code>🔁 forks</code> <code>🕒 sincronizando</code></p>",
    "    </td>",
  ].join("\n");
}

function renderBadge(label, message, color, alt) {
  const src = `https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(message)}-${color}?style=for-the-badge&labelColor=1F1F1F`;
  return `<img src="${src}" alt="${escapeHtml(alt)}" />`;
}

function renderMetricBadge(label, value, color, alt) {
  const src = `https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(value)}-${color}?style=flat-square`;
  return `<img src="${src}" alt="${escapeHtml(alt)}" />`;
}

function getDescription(description) {
  if (!description || !description.trim()) {
    return "Projeto em destaque na vitrine institucional do Instituto Mauá de Tecnologia.";
  }

  const normalized = description.trim().replace(/\s+/g, " ");
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function formatCount(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

function formatDate(dateInput) {
  if (!dateInput) {
    return "sem data";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(dateInput));
}

function formatDateTime(dateInput) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(dateInput);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
