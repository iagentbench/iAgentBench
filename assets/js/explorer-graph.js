(function () {
  "use strict";

  var GRAPHML_URL   = "assets/temp/interactive_graph_temp.graphml";
  var META_URL      = "assets/temp/interactive_graph_meta.json";
  var COMMUNITY_DETAILS_URL = "assets/temp/community_details.json";

  // Notebook-exact community colour palette (index % 7)
  var COMMUNITY_COLORS = [
    "crimson", "darkorange", "indigo", "cornflowerblue", "cyan", "teal", "green",
  ];
  var TYPE_COLORS = {
    PERSON: "crimson", ORGANIZATION: "cornflowerblue", GEO: "teal", EVENT: "darkorange",
  };
  var TYPE_LABELS = {
    PERSON: "Person", ORGANIZATION: "Organization", GEO: "Geography", EVENT: "Event",
  };
  var DEFAULT_COLOR = "lightgray";

  // ── Module-level state ─────────────────────────────────────────────────────
  var _cy           = null;
  var _clusters     = null;
  var _currentLayout = "force";
  var _focusedComm  = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function communityColor(commInt) {
    if (commInt === null || commInt === undefined) return null;
    return COMMUNITY_COLORS[commInt % COMMUNITY_COLORS.length];
  }

  function extractData(el, keyMap) {
    var out = {};
    el.querySelectorAll("data").forEach(function (d) {
      var name = keyMap[d.getAttribute("key")];
      if (name) out[name] = d.textContent.trim();
    });
    return out;
  }

  // ── GraphML parser ─────────────────────────────────────────────────────────
  function parseGraphML(xml, communityMeta) {
    var keyMap = {};
    xml.querySelectorAll("key").forEach(function (k) {
      keyMap[k.getAttribute("id")] = k.getAttribute("attr.name");
    });

    // First pass: compute degree from edges
    var degree = {};
    var edgesRaw = [];
    xml.querySelectorAll("edge").forEach(function (edgeEl) {
      var src   = edgeEl.getAttribute("source");
      var tgt   = edgeEl.getAttribute("target");
      var props = extractData(edgeEl, keyMap);
      degree[src] = (degree[src] || 0) + 1;
      degree[tgt] = (degree[tgt] || 0) + 1;
      edgesRaw.push({ src: src, tgt: tgt, props: props });
    });

    var nodes = [];
    var clusterMap = {};
    var legendEntries = [];
    var seenComm = {};

    xml.querySelectorAll("node").forEach(function (nodeEl) {
      var id    = nodeEl.getAttribute("id");
      var props = extractData(nodeEl, keyMap);
      var type  = (props.type || "").toUpperCase();
      var commRaw = props.community || null;
      var commInt = commRaw !== null ? Math.round(parseFloat(commRaw)) : null;
      var commKey = commInt !== null ? String(commInt) : "__none__";

      var color = communityColor(commInt);
      if (color === null) color = TYPE_COLORS[type] || DEFAULT_COLOR;

      var deg   = degree[id] || 1;
      var scale = 0.5 + (deg * 1.5 / 20);
      var size  = Math.max(18, Math.min(60, 14 * scale + 8));

      // Build cluster map for CiSE
      if (commKey !== "__none__") {
        if (!clusterMap[commKey]) clusterMap[commKey] = [];
        clusterMap[commKey].push(id);
      }

      // Build legend (once per community, sorted later)
      if (commInt !== null && !(commInt in seenComm)) {
        seenComm[commInt] = true;
        var meta  = communityMeta && communityMeta[commKey];
        var label = meta ? meta.title : "Community " + commInt;
        legendEntries.push({ commInt: commInt, commKey: commKey, label: label, color: color });
      }

      nodes.push({
        data: {
          id:          id,
          label:       props.label || id,
          type:        type,
          community:   commKey,
          commInt:     commInt,
          color:       color,
          degree:      deg,
          size:        size,
          description: props.description || "",
        },
      });
    });

    legendEntries.sort(function (a, b) { return a.commInt - b.commInt; });
    if (nodes.some(function (n) { return n.data.community === "__none__"; })) {
      legendEntries.push({ commKey: "__none__", label: "Other", color: DEFAULT_COLOR });
    }

    var edges = [];
    edgesRaw.forEach(function (e, i) {
      var weight = parseFloat(e.props.weight) || 1;
      edges.push({
        data: {
          id:              "e" + i,
          source:          e.src,
          target:          e.tgt,
          label:           e.props.label           || "",
          fullDescription: e.props.full_description || "",
          weight:          weight,
          width:           Math.max(0.8, Math.min(5, Math.log2(weight + 1))),
        },
      });
    });

    return {
      nodes: nodes,
      edges: edges,
      clusters: Object.values(clusterMap),
      legendEntries: legendEntries,
    };
  }

  // ── Layout builders ────────────────────────────────────────────────────────
  function buildLayout(name, clusters) {
    if (name === "circular") {
      var hasCise = false;
      try {
        var t = cytoscape({ headless: true });
        t.layout({ name: "cise" }).stop();
        t.destroy();
        hasCise = true;
      } catch (_) {}
      if (hasCise && clusters && clusters.length > 1) {
        return {
          name: "cise", clusters: clusters,
          animate: true, animationDuration: 800, fit: true, padding: 44,
          nodeSeparation: 14, idealInterClusterEdgeLengthCoefficient: 1.6,
          allowNodesInsideCircle: false, maxRatioOfNodesInsideCircle: 0.1,
          springCoeff: 0.45, gravity: 0.25, gravityRange: 3.8, numIter: 2500,
        };
      }
      name = "radial"; // CiSE unavailable → fall through
    }
    if (name === "radial") {
      return {
        name: "concentric",
        concentric:  function (node)  { return node.data("degree"); },
        levelWidth:  function (nodes) { return Math.max(1, nodes.maxDegree() / 4); },
        animate: true, animationDuration: 800, fit: true, padding: 44, minNodeSpacing: 12,
      };
    }
    // "force"
    return {
      name: "cose",
      animate: true, animationDuration: 800, fit: true, padding: 44,
      nodeRepulsion: 400000, idealEdgeLength: 80, gravity: 80,
      numIter: 1000, randomize: true,
    };
  }

  // ── Cytoscape styles ───────────────────────────────────────────────────────
  function cyStyles() {
    return [
      {
        selector: "node",
        style: {
          "background-color":    "data(color)",
          "width":               "data(size)",
          "height":              "data(size)",
          "label":               "data(label)",
          "color":               "#ffffff",
          "font-size":            9,
          "font-family":         "Inter, ui-sans-serif, system-ui, Arial, sans-serif",
          "font-weight":          500,
          "text-valign":         "center",
          "text-halign":         "center",
          "text-wrap":           "wrap",
          "text-max-width":       68,
          "border-width":         1.5,
          "border-color":        "rgba(255,255,255,0.20)",
          "text-outline-color":  "rgba(0,0,0,0.75)",
          "text-outline-width":   1.5,
          "transition-property": "opacity border-width border-color",
          "transition-duration": "150ms",
          "cursor":              "pointer",
        },
      },
      {
        selector: "edge",
        style: {
          "width":               "data(width)",
          "line-color":          "rgba(255,255,255,0.16)",
          "target-arrow-color":  "rgba(255,255,255,0.28)",
          "target-arrow-shape":  "vee",
          "arrow-scale":          0.85,
          "curve-style":         "bezier",
          "opacity":              0.88,
          "transition-property": "opacity line-color",
          "transition-duration": "150ms",
          "cursor":              "pointer",
        },
      },
      {
        selector: "node:selected",
        style: { "border-color": "#a78bfa", "border-width": 3 },
      },
      {
        selector: "edge:selected",
        style: {
          "line-color":         "rgba(167,139,250,0.65)",
          "target-arrow-color": "rgba(167,139,250,0.85)",
        },
      },
      {
        selector: ".dimmed",
        style: { "opacity": 0.08 },
      },
      {
        selector: ".edge-label",
        style: {
          "label":                   "data(label)",
          "font-size":                8,
          "color":                   "rgba(255,255,255,0.7)",
          "text-background-color":   "#0c1426",
          "text-background-opacity":  0.9,
          "text-background-padding": "2px",
          "text-background-shape":   "roundrectangle",
          "opacity":                  1,
        },
      },
    ];
  }

  // ── Community focus ────────────────────────────────────────────────────────
  function applyFocus(commKey) {
    if (!_cy) return;
    _cy.elements().removeClass("dimmed");
    if (!commKey) return;
    _cy.nodes().forEach(function (n) {
      if (n.data("community") !== commKey) n.addClass("dimmed");
    });
    _cy.edges().forEach(function (e) {
      var src = _cy.getElementById(e.data("source")).data("community");
      var tgt = _cy.getElementById(e.data("target")).data("community");
      if (src !== commKey || tgt !== commKey) e.addClass("dimmed");
    });
  }

  function toggleCommunityFocus(commKey, detailPanel, communityMeta, communityDetailsById) {
    if (!_cy) return;
    var legendEl = document.getElementById("graph-legend");
    if (_focusedComm === commKey) {
      _focusedComm = null;
      _cy.elements().removeClass("dimmed");
      hideDetailPanel(detailPanel);
      if (legendEl) legendEl.querySelectorAll(".graph-legend-item").forEach(function (el) {
        el.classList.remove("is-focused");
      });
    } else {
      _focusedComm = commKey;
      applyFocus(commKey);
      if (legendEl) legendEl.querySelectorAll(".graph-legend-item").forEach(function (el) {
        el.classList.toggle("is-focused", el.dataset.commKey === commKey);
      });
      showDetailPanel(detailPanel, communityDetailHTML(commKey, communityMeta, communityDetailsById));
    }
  }

  // ── Layout switching ───────────────────────────────────────────────────────
  function switchLayout(name) {
    if (!_cy || !_clusters) return;
    _currentLayout = name;
    _cy.layout(buildLayout(name, _clusters)).run();
    document.querySelectorAll(".graph-layout-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.layout === name);
    });
  }

  // ── Detail panel HTML builders ─────────────────────────────────────────────
  function nodeDetailHTML(node, communityMeta) {
    var label   = node.data("label");
    var type    = node.data("type");
    var commInt = node.data("commInt");
    var desc    = node.data("description");
    var deg     = node.data("degree");
    var color   = node.data("color");

    var typeLabel  = TYPE_LABELS[type] || (type ? type : "");
    var commTitle  = "";
    if (commInt !== null) {
      var m = communityMeta && communityMeta[String(commInt)];
      commTitle = m ? m.title : "Community " + commInt;
    }

    var neighbors = node.neighborhood("node").map(function (n) {
      return "<span class=\"gdp-neighbor\">" + esc(n.data("label")) + "</span>";
    }).join("");

    return (
      "<div class=\"gdp-header\">" +
        (color ? "<span class=\"gdp-dot\" style=\"background:" + color + "\"></span>" : "") +
        "<span class=\"gdp-name\">" + esc(label) + "</span>" +
      "</div>" +
      (typeLabel  ? "<span class=\"gdp-badge\">" + esc(typeLabel)  + "</span>" : "") +
      (commTitle  ? "<div class=\"gdp-comm\">" + esc(commTitle) + "</div>" : "") +
      "<div class=\"gdp-stat\">" + deg + " connection" + (deg !== 1 ? "s" : "") + "</div>" +
      (desc ? "<div class=\"gdp-section-label\">Description</div><div class=\"gdp-desc\">" + esc(desc) + "</div>" : "") +
      (neighbors ? "<div class=\"gdp-section-label\">Connected to</div><div class=\"gdp-neighbors\">" + neighbors + "</div>" : "")
    );
  }

  function edgeDetailHTML(edge) {
    var srcNode = _cy && _cy.getElementById(edge.data("source"));
    var tgtNode = _cy && _cy.getElementById(edge.data("target"));
    var srcLabel = srcNode ? esc(srcNode.data("label")) : esc(edge.data("source"));
    var tgtLabel = tgtNode ? esc(tgtNode.data("label")) : esc(edge.data("target"));
    var fullDesc = edge.data("fullDescription");
    var weight   = edge.data("weight");

    return (
      "<div class=\"gdp-header\">" +
        "<span class=\"gdp-name gdp-edge-name\">" + srcLabel + " → " + tgtLabel + "</span>" +
      "</div>" +
      "<div class=\"gdp-stat\">Weight: " + weight + "</div>" +
      (fullDesc
        ? "<div class=\"gdp-section-label\">Relationship</div><div class=\"gdp-desc\">" + esc(fullDesc) + "</div>"
        : "")
    );
  }

  function communityDetailHTML(commKey, communityMeta, communityDetailsById) {
    if (!commKey) return "<p class=\"gdp-muted\">Select a community from the legend.</p>";
    if (commKey === "__none__") {
      return "<div class=\"gdp-header\"><span class=\"gdp-name\">Other</span></div>" +
             "<p class=\"gdp-muted\">Nodes not assigned to a community.</p>";
    }
    var meta = communityMeta && communityMeta[commKey];
    var full = communityDetailsById && communityDetailsById[commKey];
    var title = (full && full.title) || (meta && meta.title) || "Community " + commKey;
    var html =
      "<div class=\"gdp-header\">" +
        "<span class=\"gdp-name\">" + esc(title) + "</span>" +
      "</div>";
    if (meta && meta.type) {
      html += "<span class=\"gdp-badge\">" + esc(meta.type) + "</span>";
    }
    var summary = (full && full.summary) || (meta && meta.summary);
    if (summary) {
      var summaryHtml = esc(summary).replace(/\n\n/g, "</p><p class=\"gdp-para\">").replace(/\n/g, "<br>");
      html += "<div class=\"gdp-section-label\">Summary</div><div class=\"gdp-desc gdp-desc-full\"><p class=\"gdp-para\">" + summaryHtml + "</p></div>";
    }
    var findings = (full && full.findings && full.findings.length) ? full.findings : (meta && meta.top_findings) || [];
    if (findings.length > 0) {
      html += "<div class=\"gdp-section-label\">Key findings</div>";
      html += "<ul class=\"gdp-findings\">";
      findings.slice(0, 8).forEach(function (f) {
        var expl = (f.explanation || f.snippet || "").trim();
        var sum  = (f.summary || "").trim();
        html += "<li class=\"gdp-finding\">" +
          (sum ? "<strong>" + esc(sum) + "</strong>" : "") +
          (expl ? "<span class=\"gdp-finding-snippet\">" + esc(expl) + "</span>" : "") +
          "</li>";
      });
      html += "</ul>";
    }
    return html;
  }

  // ── Detail panel show / hide ───────────────────────────────────────────────
  function showDetailPanel(panel, html) {
    panel.innerHTML =
      "<button class=\"gdp-close\" id=\"gdp-close\" title=\"Close\">\u00d7</button>" +
      "<div class=\"gdp-body\">" + html + "</div>";
    panel.classList.add("is-open");
    var closeBtn = document.getElementById("gdp-close");
    if (closeBtn) closeBtn.addEventListener("click", function () { hideDetailPanel(panel); });
  }

  function hideDetailPanel(panel) {
    panel.classList.remove("is-open");
    if (_cy) _cy.elements().unselect();
  }

  // ── Hover tooltip ──────────────────────────────────────────────────────────
  function showHoverTooltip(tooltipEl, node, communityMeta) {
    var commInt  = node.data("commInt");
    var typeLabel = TYPE_LABELS[node.data("type")] || "";
    var commTitle = "";
    if (commInt !== null) {
      var m = communityMeta && communityMeta[String(commInt)];
      commTitle = m ? m.title : "Community " + commInt;
    }
    tooltipEl.innerHTML =
      "<div class=\"graph-tip-name\">" + esc(node.data("label")) + "</div>" +
      (typeLabel  ? "<div class=\"graph-tip-type\">" + esc(typeLabel) + "</div>"  : "") +
      (commTitle  ? "<div class=\"graph-tip-comm\">" + esc(commTitle) + "</div>"  : "") +
      "<div class=\"graph-tip-deg\">" + node.data("degree") + " connection" + (node.data("degree") !== 1 ? "s" : "") + "</div>";
    tooltipEl.hidden = false;
  }

  function positionTooltip(tooltipEl, container, e) {
    var rect = container.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var tw = tooltipEl.offsetWidth || 175, th = tooltipEl.offsetHeight || 72;
    tooltipEl.style.left = Math.min(x + 16, container.offsetWidth  - tw - 6) + "px";
    tooltipEl.style.top  = Math.max(4, Math.min(y - 14, container.offsetHeight - th - 6)) + "px";
  }

  // ── Interactions ───────────────────────────────────────────────────────────
  function bindInteractions(cy, container, tooltipEl, detailPanel, communityMeta) {

    // Hover on node
    cy.on("mouseover", "node", function (evt) {
      var node = evt.target;
      var hood = node.closedNeighborhood();
      cy.elements().difference(hood).addClass("dimmed");
      hood.edges().addClass("edge-label");
      showHoverTooltip(tooltipEl, node, communityMeta);
    });
    cy.on("mouseout", "node", function () {
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      tooltipEl.hidden = true;
      // Re-apply community focus if active
      if (_focusedComm) applyFocus(_focusedComm);
    });

    // Hover on edge
    cy.on("mouseover", "edge", function (evt) {
      evt.target.addClass("edge-label");
    });
    cy.on("mouseout", "edge", function (evt) {
      evt.target.removeClass("edge-label");
    });

    // Click on node → detail panel + dim neighbourhood
    cy.on("tap", "node", function (evt) {
      var node = evt.target;
      _focusedComm = null;
      document.querySelectorAll("#graph-legend .graph-legend-item.is-focused").forEach(function (el) {
        el.classList.remove("is-focused");
      });
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      node.closedNeighborhood().edges().addClass("edge-label");
      cy.elements().difference(node.closedNeighborhood()).addClass("dimmed");
      tooltipEl.hidden = true;
      showDetailPanel(detailPanel, nodeDetailHTML(node, communityMeta));
    });

    // Click on edge → detail panel
    cy.on("tap", "edge", function (evt) {
      var edge = evt.target;
      _focusedComm = null;
      document.querySelectorAll("#graph-legend .graph-legend-item.is-focused").forEach(function (el) {
        el.classList.remove("is-focused");
      });
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      edge.addClass("edge-label");
      tooltipEl.hidden = true;
      showDetailPanel(detailPanel, edgeDetailHTML(edge));
    });

    // Click on canvas → reset
    cy.on("tap", function (evt) {
      if (evt.target !== cy) return;
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      hideDetailPanel(detailPanel);
      if (_focusedComm) applyFocus(_focusedComm);
    });

    // Follow mouse for tooltip
    container.addEventListener("mousemove", function (e) {
      if (!tooltipEl.hidden) positionTooltip(tooltipEl, container, e);
    });
  }

  // ── Mount UI ───────────────────────────────────────────────────────────────
  function buildLegendHTML(legendEntries) {
    return legendEntries.map(function (e) {
      return (
        "<span class=\"graph-legend-item\" data-comm-key=\"" + esc(e.commKey) + "\" title=\"" + esc(e.label) + "\">" +
        "<span class=\"graph-legend-dot\" style=\"background:" + e.color + "\"></span>" +
        "<span class=\"graph-legend-label\">" + esc(e.label) + "</span>" +
        "</span>"
      );
    }).join("");
  }

  function mountUI(placeholder, legendEntries) {
    placeholder.classList.remove("graph-placeholder");
    placeholder.classList.add("graph-panel");

    var header = document.createElement("div");
    header.className = "graph-header";
    header.innerHTML =
      "<div class=\"graph-legend\" id=\"graph-legend\">" + buildLegendHTML(legendEntries) + "</div>" +
      "<div class=\"graph-header-right\">" +
        "<div class=\"graph-layout-group\" role=\"group\" aria-label=\"Layout\">" +
          "<button type=\"button\" class=\"graph-layout-btn\" data-layout=\"circular\">Circular</button>" +
          "<button type=\"button\" class=\"graph-layout-btn\" data-layout=\"radial\">Radial</button>" +
          "<button type=\"button\" class=\"graph-layout-btn is-active\" data-layout=\"force\">Force</button>" +
        "</div>" +
        "<div class=\"graph-controls\">" +
          "<button type=\"button\" class=\"graph-btn\" id=\"graph-fit\"      title=\"Fit to view\">\u229e</button>" +
          "<button type=\"button\" class=\"graph-btn\" id=\"graph-zoom-in\"  title=\"Zoom in\">+</button>" +
          "<button type=\"button\" class=\"graph-btn\" id=\"graph-zoom-out\" title=\"Zoom out\">\u2212</button>" +
        "</div>" +
      "</div>";

    var wrap = document.createElement("div");
    wrap.className = "graph-canvas-wrap";

    var cyDiv = document.createElement("div");
    cyDiv.id = "cy";
    cyDiv.className = "graph-cy";

    var tooltipEl = document.createElement("div");
    tooltipEl.className = "graph-tooltip";
    tooltipEl.hidden = true;

    var detailPanel = document.createElement("div");
    detailPanel.className = "graph-detail-panel";

    var loadingEl = document.createElement("div");
    loadingEl.className = "graph-loading";
    loadingEl.innerHTML = "<span class=\"graph-spinner\"></span>Loading graph\u2026";

    wrap.appendChild(cyDiv);
    wrap.appendChild(tooltipEl);
    wrap.appendChild(detailPanel);
    wrap.appendChild(loadingEl);

    placeholder.innerHTML = "";
    placeholder.appendChild(header);
    placeholder.appendChild(wrap);

    return { cyDiv: cyDiv, tooltipEl: tooltipEl, detailPanel: detailPanel, loadingEl: loadingEl };
  }

  function wireControls(ui, communityMeta, communityDetailsById) {
    var fitBtn = document.getElementById("graph-fit");
    var ziBtn  = document.getElementById("graph-zoom-in");
    var zoBtn  = document.getElementById("graph-zoom-out");
    if (fitBtn) fitBtn.addEventListener("click", function () { if (_cy) _cy.fit(undefined, 44); });
    if (ziBtn)  ziBtn.addEventListener("click",  function () {
      if (_cy) _cy.zoom({ level: _cy.zoom() * 1.35, renderedPosition: { x: _cy.width() / 2, y: _cy.height() / 2 } });
    });
    if (zoBtn)  zoBtn.addEventListener("click",  function () {
      if (_cy) _cy.zoom({ level: _cy.zoom() / 1.35, renderedPosition: { x: _cy.width() / 2, y: _cy.height() / 2 } });
    });

    // Layout toggles
    document.querySelectorAll(".graph-layout-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchLayout(btn.dataset.layout); });
    });

    // Legend click → community focus + show community context
    var legendEl = document.getElementById("graph-legend");
    if (legendEl) {
      legendEl.addEventListener("click", function (e) {
        var item = e.target.closest(".graph-legend-item");
        if (item) toggleCommunityFocus(item.dataset.commKey, ui.detailPanel, communityMeta || {}, communityDetailsById || {});
      });
    }
  }

  // ── Entry ──────────────────────────────────────────────────────────────────
  function init() {
    if (typeof cytoscapeCise !== "undefined" && typeof cytoscape !== "undefined") {
      try { cytoscape.use(cytoscapeCise); } catch (_) {}
    }

    var placeholder = document.getElementById("graph-placeholder");
    if (!placeholder) return;

    // Quick loading state while fetching
    placeholder.classList.remove("graph-placeholder");
    placeholder.classList.add("graph-panel");
    placeholder.innerHTML =
      "<div class=\"graph-loading\" style=\"min-height:420px;position:relative\">" +
      "<span class=\"graph-spinner\"></span>Loading graph\u2026</div>";

    Promise.all([
      fetch(GRAPHML_URL).then(function (r) {
        if (!r.ok) throw new Error("GraphML: HTTP " + r.status);
        return r.text();
      }),
      fetch(META_URL).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
      fetch(COMMUNITY_DETAILS_URL).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ])
    .then(function (results) {
      var communityMeta = (results[1] && results[1].communities) ? results[1].communities : {};
      var communityDetailsList = (results[2] && results[2].communities) ? results[2].communities : [];
      var communityDetailsById = {};
      communityDetailsList.forEach(function (c) {
        if (c.id !== undefined) communityDetailsById[String(c.id)] = c;
      });
      var xml  = new DOMParser().parseFromString(results[0], "text/xml");
      var data = parseGraphML(xml, communityMeta);
      _clusters = data.clusters;

      // Re-mount full UI
      placeholder.classList.remove("graph-panel");
      placeholder.classList.add("graph-placeholder");
      var ui = mountUI(placeholder, data.legendEntries);

      _cy = cytoscape({
        container:           ui.cyDiv,
        elements:            { nodes: data.nodes, edges: data.edges },
        style:               cyStyles(),
        layout:              buildLayout("force", _clusters),
        wheelSensitivity:    0.22,
        minZoom:             0.05,
        maxZoom:             5,
        boxSelectionEnabled: false,
      });

      bindInteractions(_cy, ui.cyDiv, ui.tooltipEl, ui.detailPanel, communityMeta);

      _cy.one("layoutstop", function () {
        ui.loadingEl.style.transition = "opacity 0.3s";
        ui.loadingEl.style.opacity    = "0";
        setTimeout(function () {
          if (ui.loadingEl.parentNode) ui.loadingEl.parentNode.removeChild(ui.loadingEl);
        }, 320);
        wireControls(ui, communityMeta, communityDetailsById);
      });
    })
    .catch(function (err) {
      placeholder.innerHTML =
        "<div class=\"graph-loading\" style=\"min-height:120px\">" +
        "<span style=\"color:#f87171\">Could not load graph: " + esc(err.message) + "</span></div>";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
