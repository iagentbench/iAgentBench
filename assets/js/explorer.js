(function () {
  const DATA_URL = "assets/data/iAgentBench.json";
  const QA_PREVIEW_LEN = 120;
  const JUDGE_CRITERIA = [
    "evidence_only_support",
    "multi_community_necessity",
    "connector_necessity",
    "objective_qa",
    "natural_user_question",
    "anti_trivia",
    "evidence_presence_consistency",
    "standalone_clarity",
  ];
  const CRITERION_LABELS = {
    evidence_only_support: "Evidence only support",
    multi_community_necessity: "Multi-community necessity",
    connector_necessity: "Connector necessity",
    objective_qa: "Objective QA",
    natural_user_question: "Natural user question",
    anti_trivia: "Anti-trivia",
    evidence_presence_consistency: "Evidence presence consistency",
    standalone_clarity: "Standalone clarity",
  };

  function parseJson(str, fallback) {
    if (str == null || str === "") return fallback != null ? fallback : [];
    try {
      const out = JSON.parse(str);
      return out != null ? out : (fallback != null ? fallback : []);
    } catch (_) {
      return fallback != null ? fallback : [];
    }
  }

  function truncate(s, len) {
    if (s == null) return "";
    const t = String(s).trim();
    return t.length <= len ? t : t.slice(0, len) + "\u2026";
  }

  function escapeHtml(s) {
    if (s == null) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  const qaListEl = document.getElementById("qa-list");
  const detailBlocks = {
    question: document.getElementById("detail-question"),
    answer: document.getElementById("detail-answer"),
    metadata: document.getElementById("detail-metadata"),
    communities: document.getElementById("detail-communities"),
    sources: document.getElementById("detail-sources"),
    judges: document.getElementById("detail-judges"),
  };
  const detailContent = {
    questionText: document.getElementById("detail-question-text"),
    answerText: document.getElementById("detail-answer-text"),
    metadataContent: document.getElementById("detail-metadata-content"),
    communitiesContent: document.getElementById("detail-communities-content"),
    sourcesContent: document.getElementById("detail-sources-content"),
    judgesContent: document.getElementById("detail-judges-content"),
  };

  let dataset = [];
  let selectedIndex = -1;

  function setBlockVisible(block, visible) {
    if (block) block.hidden = !visible;
  }

  function renderQuestionAnswer(row) {
    const q = row.question != null ? String(row.question) : "";
    const a = row.answer != null ? String(row.answer) : "";
    detailContent.questionText.textContent = q;
    detailContent.answerText.textContent = a;
    setBlockVisible(detailBlocks.question, !!q);
    setBlockVisible(detailBlocks.answer, !!a);
  }

  function renderMetadata(row) {
    const intent = row.intent_pattern != null ? String(row.intent_pattern) : "";
    const why = row.why_multi_community != null ? String(row.why_multi_community) : "";
    const time = row.relevant_time_window != null ? String(row.relevant_time_window) : "";
    const verdict = row.final_verdict != null ? String(row.final_verdict) : "";
    const passV = row.pass_votes != null ? String(row.pass_votes) : "";
    const failV = row.fail_votes != null ? String(row.fail_votes) : "";
    const html = [
      intent ? `<div class="detail-meta-item"><strong>Intent:</strong> ${escapeHtml(intent)}</div>` : "",
      time ? `<div class="detail-meta-item"><strong>Time window:</strong> ${escapeHtml(time)}</div>` : "",
      verdict ? `<div class="detail-meta-item"><strong>Verdict:</strong> ${escapeHtml(verdict)}</div>` : "",
      passV !== "" || failV !== "" ? `<div class="detail-meta-item"><strong>Votes:</strong> ${escapeHtml(passV)} pass / ${escapeHtml(failV)} fail</div>` : "",
      why ? `<div class="detail-meta-item"><strong>Why multi-community:</strong> ${escapeHtml(why)}</div>` : "",
    ].filter(Boolean).join("");
    detailContent.metadataContent.innerHTML = html || "<p class=\"muted small\">No metadata.</p>";
    setBlockVisible(detailBlocks.metadata, true);
  }

  function renderCommunities(row) {
    const raw = row.community_context_json;
    const data = parseJson(raw, {});
    const entries = typeof data === "object" && !Array.isArray(data) ? Object.entries(data) : [];
    const items = entries.map(function (entry) {
      const id = entry[0];
      const c = entry[1];
      const communityId = c.community_id != null ? String(c.community_id) : id;
      const title = c.title != null ? escapeHtml(String(c.title)) : "";
      const summary = c.summary != null ? escapeHtml(String(c.summary)) : "";
      const idLabel = "Community " + escapeHtml(String(communityId));
      return `<div class="detail-list-item"><span class="community-id">${idLabel}</span> &middot; <strong>${title || "Community"}</strong>${summary ? "<br>" + summary : ""}</div>`;
    });
    detailContent.communitiesContent.innerHTML = items.length ? items.join("") : "<p class=\"muted small\">None.</p>";
    setBlockVisible(detailBlocks.communities, true);
  }

  function renderSources(row) {
    const urls = row.relevant_source_doc_urls;
    const list = Array.isArray(urls) ? urls : parseJson(typeof urls === "string" ? urls : "", []);
    const items = list.map(function (url) {
      const href = escapeHtml(String(url));
      return `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a></li>`;
    });
    detailContent.sourcesContent.innerHTML = items.length ? items.join("") : "<li class=\"muted small\">None.</li>";
    setBlockVisible(detailBlocks.sources, true);
  }

  function renderJudges(row) {
    const frags = [];
    for (let n = 1; n <= 3; n++) {
      const prefix = "llm_judge" + n + "_";
      const model = row[prefix + "model"];
      const verdict = row[prefix + "verdict"];
      const verdictClass = (verdict || "").toUpperCase() === "PASS" ? "pass" : "fail";
      let inner = "<h4>LLM Judge " + n + "</h4>";
      if (model) inner += "<p class=\"small muted\">" + escapeHtml(String(model)) + "</p>";
      inner += "<div class=\"judge-verdict " + verdictClass + "\">" + escapeHtml(String(verdict || "")) + "</div>";
      JUDGE_CRITERIA.forEach(function (key) {
        const flag = row[prefix + key + "_flag"];
        const reasoning = row[prefix + key + "_reasoning"];
        const label = CRITERION_LABELS[key] || key;
        const flagStr = flag === true ? "true" : flag === false ? "false" : "";
        if (flagStr === "" && !reasoning) return;
        inner += "<div class=\"judge-criterion\"><span class=\"judge-criterion-label\">" + escapeHtml(label) + ":</span> " + flagStr;
        if (reasoning) inner += "<span class=\"judge-criterion-reasoning\">" + escapeHtml(String(reasoning)) + "</span>";
        inner += "</div>";
      });
      frags.push("<div class=\"judge-card\">" + inner + "</div>");
    }
    detailContent.judgesContent.innerHTML = frags.join("");
    setBlockVisible(detailBlocks.judges, true);
  }

  function selectRow(index) {
    selectedIndex = index;
    const items = qaListEl && qaListEl.querySelectorAll(".qa-list-item");
    if (items) items.forEach(function (el, i) { el.classList.toggle("is-selected", i === index); });
    const row = dataset[index];
    if (!row) return;
    renderQuestionAnswer(row);
    renderMetadata(row);
    renderCommunities(row);
    renderSources(row);
    renderJudges(row);
    if (typeof window.loadGraphForKeyTerms === "function") {
      window.loadGraphForKeyTerms(row.key_terms);
    }
  }

  function buildQaList() {
    if (!qaListEl) return;
    qaListEl.innerHTML = "";
    dataset.forEach(function (row, i) {
      const id = row.id != null ? String(row.id) : String(i + 1);
      const preview = truncate(row.question, QA_PREVIEW_LEN);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qa-list-item";
      btn.setAttribute("role", "listitem");
      btn.innerHTML = "<span class=\"qa-list-item-id\">" + escapeHtml(id) + "</span><span class=\"qa-list-item-preview\">" + escapeHtml(preview) + "</span>";
      btn.addEventListener("click", function () { selectRow(i); });
      qaListEl.appendChild(btn);
    });
    if (dataset.length > 0) selectRow(0);
  }

  function loadData() {
    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("Dataset failed to load: " + r.status);
        return r.json();
      })
      .then(function (data) {
        dataset = Array.isArray(data) ? data : (data.rows ? data.rows : data.data ? data.data : []);
        buildQaList();
      })
      .catch(function (err) {
        if (qaListEl) qaListEl.innerHTML = "<p class=\"muted small\">Failed to load dataset. " + escapeHtml(String(err.message)) + "</p>";
      });
  }

  if (document.getElementById("graph-placeholder") && qaListEl) loadData();
})();
