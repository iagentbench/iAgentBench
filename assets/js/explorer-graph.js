(function () {
  "use strict";

  var GRAPHML_URL = "assets/temp/interactive_graph_temp.graphml";

  // Exact community colour palette from the notebook
  // colors[int(community) % 7]
  var COMMUNITY_COLORS = [
    "crimson",
    "darkorange",
    "indigo",
    "cornflowerblue",
    "cyan",
    "teal",
    "green",
  ];

  // Type fallback (when no community data)
  var TYPE_COLORS = {
    PERSON:       "crimson",
    ORGANIZATION: "cornflowerblue",
    GEO:          "teal",
    EVENT:        "darkorange",
  };
  var TYPE_LABELS = {
    PERSON: "Person", ORGANIZATION: "Organization", GEO: "Geography", EVENT: "Event",
  };
  var DEFAULT_COLOR = "lightgray";

  function communityColor(community) {
    if (community === null || community === undefined || community === "") {
      return null; // will fall back to type
    }
    var idx = parseInt(community, 10);
    if (isNaN(idx)) return null;
    return COMMUNITY_COLORS[idx % COMMUNITY_COLORS.length];
  }

  // ── GraphML parser ─────────────────────────────────────────────────────────

  function parseGraphML(xml) {
    var keyMap = {};
    xml.querySelectorAll("key").forEach(function (k) {
      keyMap[k.getAttribute("id")] = k.getAttribute("attr.name");
    });

    // First pass: compute degree
    var degree = {};
    var edgesRaw = [];
    xml.querySelectorAll("edge").forEach(function (edgeEl) {
      var src  = edgeEl.getAttribute("source");
      var tgt  = edgeEl.getAttribute("target");
      var props = extractData(edgeEl, keyMap);
      degree[src] = (degree[src] || 0) + 1;
      degree[tgt] = (degree[tgt] || 0) + 1;
      edgesRaw.push({ src: src, tgt: tgt, props: props });
    });

    // Build nodes
    var nodes = [];
    var communityIndex = {}; // community value → stable int index
    var communityCounter = 0;
    xml.querySelectorAll("node").forEach(function (nodeEl) {
      var id    = nodeEl.getAttribute("id");
      var props = extractData(nodeEl, keyMap);
      var type  = (props.type || "").toUpperCase();
      var comm  = props.community || null; // e.g. "9.0"
      var commInt = comm !== null ? Math.round(parseFloat(comm)) : null;

      // Assign a stable 0-based index per community for colour cycling
      var commKey = commInt !== null ? String(commInt) : "__none__";
      if (!(commKey in communityIndex)) {
        communityIndex[commKey] = communityCounter++;
      }

      var color = communityColor(commInt);
      if (color === null) color = TYPE_COLORS[type] || DEFAULT_COLOR;

      var deg  = degree[id] || 1;
      // Same scale formula as notebook: 0.5 + (degree * 1.5 / 20), mapped to px size
      var scale = 0.5 + (deg * 1.5 / 20);
      var size  = Math.max(18, Math.min(60, 14 * scale + 8));

      nodes.push({
        data: {
          id:        id,
          label:     props.label || id,
          type:      type,
          community: commKey,
          commInt:   commInt,
          color:     color,
          degree:    deg,
          size:      size,
        },
      });
    });

    // Build edges
    var edges = [];
    edgesRaw.forEach(function (e, i) {
      var weight = parseFloat(e.props.weight) || 1;
      // Same scale: thickness ∝ weight (capped)
      var width = Math.max(0.8, Math.min(5, Math.log2(weight + 1)));
      edges.push({
        data: {
          id:     "e" + i,
          source: e.src,
          target: e.tgt,
          label:  e.props.label || "",
          weight: weight,
          width:  width,
        },
      });
    });

    // Build CiSE clusters: array of arrays of node ids, one per community
    var clusterMap = {};
    nodes.forEach(function (n) {
      var c = n.data.community;
      if (c !== "__none__") {
        if (!clusterMap[c]) clusterMap[c] = [];
        clusterMap[c].push(n.data.id);
      }
    });
    var clusters = Object.values(clusterMap);

    // Build legend entries: unique communities in data order
    var legendEntries = [];
    var seenComm = {};
    nodes.forEach(function (n) {
      var c = n.data.commInt;
      if (c !== null && !(c in seenComm)) {
        seenComm[c] = true;
        legendEntries.push({ label: "Community " + c, color: n.data.color });
      }
    });
    legendEntries.sort(function (a, b) {
      return parseInt(a.label.split(" ")[1]) - parseInt(b.label.split(" ")[1]);
    });
    // Also add any type-fallback nodes
    var hasNone = nodes.some(function (n) { return n.data.community === "__none__"; });
    if (hasNone) legendEntries.push({ label: "Other", color: DEFAULT_COLOR });

    return { nodes: nodes, edges: edges, clusters: clusters, legendEntries: legendEntries };
  }

  function extractData(el, keyMap) {
    var out = {};
    el.querySelectorAll("data").forEach(function (d) {
      var name = keyMap[d.getAttribute("key")];
      if (name) out[name] = d.textContent.trim();
    });
    return out;
  }

  // ── Cytoscape styles ───────────────────────────────────────────────────────

  function cyStyles() {
    return [
      {
        selector: "node",
        style: {
          "background-color":   "data(color)",
          "width":              "data(size)",
          "height":             "data(size)",
          "label":              "data(label)",
          "color":              "#ffffff",
          "font-size":          9,
          "font-family":        "Inter, ui-sans-serif, system-ui, Arial, sans-serif",
          "font-weight":        500,
          "text-valign":        "center",
          "text-halign":        "center",
          "text-wrap":          "wrap",
          "text-max-width":     68,
          "border-width":       1.5,
          "border-color":       "rgba(255,255,255,0.20)",
          "text-outline-color": "rgba(0,0,0,0.75)",
          "text-outline-width": 1.5,
          "transition-property":"opacity border-width border-color",
          "transition-duration":"150ms",
        },
      },
      {
        selector: "edge",
        style: {
          "width":              "data(width)",
          "line-color":         "rgba(255,255,255,0.16)",
          "target-arrow-color": "rgba(255,255,255,0.28)",
          "target-arrow-shape": "vee",
          "arrow-scale":         0.85,
          "curve-style":        "bezier",
          "opacity":             0.88,
        },
      },
      {
        selector: "node:selected",
        style: { "border-color": "#a78bfa", "border-width": 3 },
      },
      {
        selector: ".dimmed",
        style: { "opacity": 0.08 },
      },
      {
        selector: ".edge-label",
        style: {
          "label":                    "data(label)",
          "font-size":                 8,
          "color":                    "rgba(255,255,255,0.7)",
          "text-background-color":    "#0c1426",
          "text-background-opacity":   0.9,
          "text-background-padding":  "2px",
          "text-background-shape":    "roundrectangle",
          "opacity":                   1,
        },
      },
    ];
  }

  // ── Cytoscape init ─────────────────────────────────────────────────────────

  function initCytoscape(container, tooltipEl, data) {
    var layoutCfg = buildLayout(data.clusters);

    var cy = cytoscape({
      container:           container,
      elements:            { nodes: data.nodes, edges: data.edges },
      style:               cyStyles(),
      layout:              layoutCfg,
      wheelSensitivity:    0.22,
      minZoom:             0.05,
      maxZoom:             5,
      boxSelectionEnabled: false,
    });

    bindInteractions(cy, container, tooltipEl);
    return cy;
  }

  function buildLayout(clusters) {
    // Try CiSE first (community circles), fall back to concentric (degree-based rings)
    var hasCise = false;
    try {
      var t = cytoscape({ headless: true });
      t.layout({ name: "cise" }).stop();
      t.destroy();
      hasCise = true;
    } catch (_) { hasCise = false; }

    if (hasCise && clusters && clusters.length > 1) {
      return {
        name:                               "cise",
        clusters:                            clusters,
        animate:                             true,
        animationDuration:                   900,
        fit:                                 true,
        padding:                             44,
        nodeSeparation:                      14,
        idealInterClusterEdgeLengthCoefficient: 1.6,
        allowNodesInsideCircle:              false,
        maxRatioOfNodesInsideCircle:         0.1,
        springCoeff:                         0.45,
        gravity:                             0.25,
        gravityRange:                        3.8,
        numIter:                             2500,
      };
    }
    // Fallback: concentric by degree (hub nodes in centre)
    return {
      name:             "concentric",
      concentric:       function (node) { return node.data("degree"); },
      levelWidth:       function (nodes) { return Math.max(1, nodes.maxDegree() / 4); },
      animate:           true,
      animationDuration: 800,
      fit:               true,
      padding:           44,
      minNodeSpacing:    12,
    };
  }

  // ── Interactions ───────────────────────────────────────────────────────────

  function bindInteractions(cy, container, tooltipEl) {
    cy.on("mouseover", "node", function (evt) {
      var node = evt.target;
      var hood = node.closedNeighborhood();
      cy.elements().difference(hood).addClass("dimmed");
      hood.edges().addClass("edge-label");
      showTooltip(tooltipEl, node);
    });

    cy.on("mouseout", "node", function () {
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      tooltipEl.hidden = true;
    });

    cy.on("tap", "node", function (evt) {
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      var hood = evt.target.closedNeighborhood();
      cy.elements().difference(hood).addClass("dimmed");
      hood.edges().addClass("edge-label");
    });

    cy.on("tap", function (evt) {
      if (evt.target === cy) {
        cy.elements().removeClass("dimmed").removeClass("edge-label");
      }
    });

    container.addEventListener("mousemove", function (e) {
      if (!tooltipEl.hidden) positionTooltip(tooltipEl, container, e);
    });
  }

  function showTooltip(tooltipEl, node) {
    var label  = node.data("label");
    var type   = node.data("type");
    var comm   = node.data("commInt");
    var deg    = node.data("degree");
    var typeLabel = TYPE_LABELS[type] || (type || "");
    tooltipEl.innerHTML =
      "<div class=\"graph-tip-name\">" + esc(label) + "</div>" +
      (typeLabel ? "<div class=\"graph-tip-type\">" + esc(typeLabel) + "</div>" : "") +
      (comm !== null ? "<div class=\"graph-tip-comm\">Community " + esc(String(comm)) + "</div>" : "") +
      "<div class=\"graph-tip-deg\">" + deg + " connection" + (deg !== 1 ? "s" : "") + "</div>";
    tooltipEl.hidden = false;
  }

  function positionTooltip(tooltipEl, container, e) {
    var rect = container.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var tw = tooltipEl.offsetWidth  || 175;
    var th = tooltipEl.offsetHeight || 72;
    tooltipEl.style.left = Math.min(x + 16, container.offsetWidth  - tw - 6) + "px";
    tooltipEl.style.top  = Math.max(4, Math.min(y - 14, container.offsetHeight - th - 6)) + "px";
  }

  // ── Legend ─────────────────────────────────────────────────────────────────

  function buildLegend(legendEntries) {
    return legendEntries.map(function (e) {
      return "<span class=\"graph-legend-item\">" +
             "<span class=\"graph-legend-dot\" style=\"background:" + e.color + "\"></span>" +
             esc(e.label) + "</span>";
    }).join("");
  }

  // ── Mount UI ───────────────────────────────────────────────────────────────

  function mountUI(placeholder, legendEntries) {
    placeholder.classList.remove("graph-placeholder");
    placeholder.classList.add("graph-panel");

    var header = document.createElement("div");
    header.className = "graph-header";
    header.innerHTML =
      "<div class=\"graph-legend\" id=\"graph-legend\">" + buildLegend(legendEntries) + "</div>" +
      "<div class=\"graph-controls\">" +
      "<button type=\"button\" class=\"graph-btn\" id=\"graph-fit\"   title=\"Fit to view\">⊞</button>" +
      "<button type=\"button\" class=\"graph-btn\" id=\"graph-zoom-in\"  title=\"Zoom in\">+</button>" +
      "<button type=\"button\" class=\"graph-btn\" id=\"graph-zoom-out\" title=\"Zoom out\">−</button>" +
      "</div>";

    var wrap = document.createElement("div");
    wrap.className = "graph-canvas-wrap";

    var cyDiv = document.createElement("div");
    cyDiv.id = "cy";
    cyDiv.className = "graph-cy";

    var tooltipEl = document.createElement("div");
    tooltipEl.className = "graph-tooltip";
    tooltipEl.hidden = true;

    var loadingEl = document.createElement("div");
    loadingEl.className = "graph-loading";
    loadingEl.innerHTML = "<span class=\"graph-spinner\"></span>Loading graph\u2026";

    wrap.appendChild(cyDiv);
    wrap.appendChild(tooltipEl);
    wrap.appendChild(loadingEl);

    placeholder.innerHTML = "";
    placeholder.appendChild(header);
    placeholder.appendChild(wrap);

    return { cyDiv: cyDiv, tooltipEl: tooltipEl, loadingEl: loadingEl };
  }

  function wireControls(cy) {
    var fitBtn = document.getElementById("graph-fit");
    var ziBtn  = document.getElementById("graph-zoom-in");
    var zoBtn  = document.getElementById("graph-zoom-out");
    if (fitBtn) fitBtn.addEventListener("click", function () { cy.fit(undefined, 44); });
    if (ziBtn)  ziBtn.addEventListener("click", function () {
      cy.zoom({ level: cy.zoom() * 1.35, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    });
    if (zoBtn)  zoBtn.addEventListener("click", function () {
      cy.zoom({ level: cy.zoom() / 1.35, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    });
  }

  // ── Entry ──────────────────────────────────────────────────────────────────

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function init() {
    // Register CiSE plugin
    if (typeof cytoscapeCise !== "undefined" && typeof cytoscape !== "undefined") {
      try { cytoscape.use(cytoscapeCise); } catch (_) { /* already registered */ }
    }

    var placeholder = document.getElementById("graph-placeholder");
    if (!placeholder) return;

    // Show a minimal loading state immediately while fetching
    var tempLoad = document.createElement("div");
    tempLoad.className = "graph-loading";
    tempLoad.style.position = "relative";
    tempLoad.style.minHeight = "420px";
    tempLoad.style.display = "flex";
    tempLoad.style.alignItems = "center";
    tempLoad.style.justifyContent = "center";
    tempLoad.innerHTML = "<span class=\"graph-spinner\"></span>Loading graph\u2026";
    placeholder.classList.remove("graph-placeholder");
    placeholder.classList.add("graph-panel");
    placeholder.innerHTML = "";
    placeholder.appendChild(tempLoad);

    fetch(GRAPHML_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) {
        var xml  = new DOMParser().parseFromString(text, "text/xml");
        var data = parseGraphML(xml);

        // Now we have legend info — mount full UI
        placeholder.classList.remove("graph-panel");
        placeholder.classList.add("graph-placeholder");
        var ui = mountUI(placeholder, data.legendEntries);

        var cy = initCytoscape(ui.cyDiv, ui.tooltipEl, data);

        cy.one("layoutstop", function () {
          ui.loadingEl.style.transition = "opacity 0.3s";
          ui.loadingEl.style.opacity    = "0";
          setTimeout(function () {
            if (ui.loadingEl.parentNode) ui.loadingEl.parentNode.removeChild(ui.loadingEl);
          }, 320);
          wireControls(cy);
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
