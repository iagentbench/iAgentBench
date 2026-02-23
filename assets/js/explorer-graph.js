(function () {
  "use strict";

  var GRAPHML_URL = "assets/temp/interactive_graph_temp.graphml";

  var TYPE_PALETTE = {
    PERSON:       "#4dd0e1",
    GEO:          "#66bb6a",
    ORGANIZATION: "#9575cd",
    EVENT:        "#ffa726",
  };
  var TYPE_LABELS = {
    PERSON:       "Person",
    GEO:          "Geography",
    ORGANIZATION: "Organization",
    EVENT:        "Event",
  };
  var DEFAULT_COLOR = "#78909c";

  // ── GraphML parser ────────────────────────────────────────────────────────

  function parseGraphML(xml) {
    var keyMap = {};
    xml.querySelectorAll("key").forEach(function (k) {
      keyMap[k.getAttribute("id")] = k.getAttribute("attr.name");
    });

    var degree = {};
    var edgesRaw = [];
    xml.querySelectorAll("edge").forEach(function (edgeEl) {
      var src = edgeEl.getAttribute("source");
      var tgt = edgeEl.getAttribute("target");
      var props = extractData(edgeEl, keyMap);
      degree[src] = (degree[src] || 0) + 1;
      degree[tgt] = (degree[tgt] || 0) + 1;
      edgesRaw.push({ src: src, tgt: tgt, props: props });
    });

    var nodes = [];
    xml.querySelectorAll("node").forEach(function (nodeEl) {
      var id = nodeEl.getAttribute("id");
      var props = extractData(nodeEl, keyMap);
      var type = (props.type || "").toUpperCase();
      var deg = degree[id] || 1;
      nodes.push({
        data: {
          id:     id,
          label:  props.label || id,
          type:   type,
          color:  TYPE_PALETTE[type] || DEFAULT_COLOR,
          degree: deg,
          size:   Math.max(18, Math.min(56, 13 + Math.sqrt(deg) * 5.5)),
        },
      });
    });

    var edges = [];
    edgesRaw.forEach(function (e, i) {
      var weight = parseFloat(e.props.weight) || 1;
      edges.push({
        data: {
          id:     "e" + i,
          source: e.src,
          target: e.tgt,
          label:  e.props.label || "",
          weight: weight,
          width:  Math.max(0.8, Math.min(4.5, Math.log2(weight + 1))),
        },
      });
    });

    return { nodes: nodes, edges: edges };
  }

  function extractData(el, keyMap) {
    var out = {};
    el.querySelectorAll("data").forEach(function (d) {
      var name = keyMap[d.getAttribute("key")];
      if (name) out[name] = d.textContent.trim();
    });
    return out;
  }

  // ── Cytoscape styles ──────────────────────────────────────────────────────

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
          "font-size":           9,
          "font-family":         "Inter, ui-sans-serif, system-ui, Arial, sans-serif",
          "font-weight":         500,
          "text-valign":         "center",
          "text-halign":         "center",
          "text-wrap":           "wrap",
          "text-max-width":      70,
          "border-width":        1.5,
          "border-color":        "rgba(255,255,255,0.18)",
          "text-outline-color":  "rgba(0,0,0,0.75)",
          "text-outline-width":  1.5,
          "transition-property": "opacity border-width border-color",
          "transition-duration": "150ms",
        },
      },
      {
        selector: "edge",
        style: {
          "width":               "data(width)",
          "line-color":          "rgba(255,255,255,0.14)",
          "target-arrow-color":  "rgba(255,255,255,0.22)",
          "target-arrow-shape":  "vee",
          "arrow-scale":         0.8,
          "curve-style":         "bezier",
          "opacity":             0.85,
          "transition-property": "opacity",
          "transition-duration": "150ms",
        },
      },
      {
        selector: "node:selected",
        style: {
          "border-color": "#7c3aed",
          "border-width":  3,
        },
      },
      {
        selector: ".dimmed",
        style: { "opacity": 0.08 },
      },
      {
        selector: ".edge-label",
        style: {
          "label":                       "data(label)",
          "font-size":                    8,
          "color":                       "rgba(255,255,255,0.65)",
          "text-background-color":       "#0c1426",
          "text-background-opacity":      0.88,
          "text-background-padding":     "2px",
          "text-background-shape":       "roundrectangle",
          "opacity":                      1,
        },
      },
    ];
  }

  // ── Cytoscape init ────────────────────────────────────────────────────────

  function initCytoscape(container, tooltipEl, data) {
    var cy = cytoscape({
      container: container,
      elements:  data,
      style:     cyStyles(),
      layout: {
        name:              "fcose",
        quality:           "default",
        animate:            true,
        animationDuration:  800,
        animationEasing:   "ease-out",
        fit:                true,
        padding:            44,
        nodeSeparation:     80,
        idealEdgeLength:    85,
        edgeElasticity:     0.45,
        nodeRepulsion:      5500,
        gravity:            0.25,
        gravityRange:       3.8,
        numIter:            2500,
        randomize:          true,
      },
      wheelSensitivity: 0.22,
      minZoom: 0.06,
      maxZoom: 5,
      boxSelectionEnabled: false,
    });

    // Hover: highlight neighbourhood ────────────────────────────────────────
    cy.on("mouseover", "node", function (evt) {
      var node = evt.target;
      var hood = node.closedNeighborhood();
      cy.elements().difference(hood).addClass("dimmed");
      hood.edges().addClass("edge-label");
      showTooltip(tooltipEl, container, node);
    });

    cy.on("mouseout", "node", function () {
      cy.elements().removeClass("dimmed").removeClass("edge-label");
      tooltipEl.hidden = true;
    });

    // Tap to lock highlight ─────────────────────────────────────────────────
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

    // Follow mouse for tooltip ──────────────────────────────────────────────
    container.addEventListener("mousemove", function (e) {
      if (!tooltipEl.hidden) positionTooltip(tooltipEl, container, e);
    });

    return cy;
  }

  function showTooltip(tooltipEl, container, node) {
    var label = node.data("label");
    var type  = node.data("type");
    var deg   = node.data("degree");
    tooltipEl.innerHTML =
      "<div class=\"graph-tip-name\">" + esc(label) + "</div>" +
      (TYPE_LABELS[type]
        ? "<div class=\"graph-tip-type\">" + esc(TYPE_LABELS[type]) + "</div>"
        : "") +
      "<div class=\"graph-tip-deg\">" + deg + " connection" + (deg !== 1 ? "s" : "") + "</div>";
    tooltipEl.hidden = false;
  }

  function positionTooltip(tooltipEl, container, e) {
    var rect = container.getBoundingClientRect();
    var x  = e.clientX - rect.left;
    var y  = e.clientY - rect.top;
    var tw = tooltipEl.offsetWidth  || 170;
    var th = tooltipEl.offsetHeight || 64;
    var cw = container.offsetWidth;
    var ch = container.offsetHeight;
    tooltipEl.style.left = Math.min(x + 16, cw - tw - 6) + "px";
    tooltipEl.style.top  = Math.max(4, Math.min(y - 14, ch - th - 6)) + "px";
  }

  // ── Legend ────────────────────────────────────────────────────────────────

  function buildLegend() {
    var html = Object.entries(TYPE_LABELS).map(function (entry) {
      var type = entry[0], label = entry[1];
      return "<span class=\"graph-legend-item\">" +
             "<span class=\"graph-legend-dot\" style=\"background:" + TYPE_PALETTE[type] + "\"></span>" +
             label + "</span>";
    }).join("");
    html += "<span class=\"graph-legend-item\">" +
            "<span class=\"graph-legend-dot\" style=\"background:" + DEFAULT_COLOR + "\"></span>" +
            "Other</span>";
    return html;
  }

  // ── Mount UI ──────────────────────────────────────────────────────────────

  function mountUI(placeholder) {
    placeholder.classList.remove("graph-placeholder");
    placeholder.classList.add("graph-panel");

    var header = document.createElement("div");
    header.className = "graph-header";
    header.innerHTML =
      "<div class=\"graph-legend\">" + buildLegend() + "</div>" +
      "<div class=\"graph-controls\">" +
      "<button type=\"button\" class=\"graph-btn\" id=\"graph-fit\" title=\"Fit to view\">⊞</button>" +
      "<button type=\"button\" class=\"graph-btn\" id=\"graph-zoom-in\" title=\"Zoom in\">+</button>" +
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

  // ── Zoom controls ─────────────────────────────────────────────────────────

  function wireControls(cy) {
    var fit = document.getElementById("graph-fit");
    var zi  = document.getElementById("graph-zoom-in");
    var zo  = document.getElementById("graph-zoom-out");
    if (fit) fit.addEventListener("click", function () { cy.fit(undefined, 44); });
    if (zi)  zi.addEventListener("click",  function () {
      cy.zoom({ level: cy.zoom() * 1.35, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    });
    if (zo)  zo.addEventListener("click",  function () {
      cy.zoom({ level: cy.zoom() / 1.35, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    });
  }

  // ── Entry ─────────────────────────────────────────────────────────────────

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function init() {
    var placeholder = document.getElementById("graph-placeholder");
    if (!placeholder) return;

    var ui = mountUI(placeholder);

    fetch(GRAPHML_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) {
        var parser = new DOMParser();
        var xml = parser.parseFromString(text, "text/xml");
        var data = parseGraphML(xml);
        var cy = initCytoscape(ui.cyDiv, ui.tooltipEl, data);
        cy.one("layoutstop", function () {
          ui.loadingEl.style.transition = "opacity 0.3s";
          ui.loadingEl.style.opacity = "0";
          setTimeout(function () {
            if (ui.loadingEl.parentNode) ui.loadingEl.parentNode.removeChild(ui.loadingEl);
          }, 320);
          wireControls(cy);
        });
      })
      .catch(function (err) {
        ui.loadingEl.innerHTML =
          "<span style=\"color:#f87171\">Could not load graph: " + esc(err.message) + "</span>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
