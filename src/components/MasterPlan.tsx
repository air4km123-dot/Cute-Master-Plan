"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useMode } from "./ModeContext";
import FilterRail, { EMPTY_FILTERS, type Filters, type FocusScope } from "./FilterRail";
import TitleBlock from "./TitleBlock";
import ProjectInspector from "./ProjectInspector";
import ConnectionInspector from "./ConnectionInspector";
import NewConnectionDialog from "./NewConnectionDialog";
import NewProjectDialog from "./NewProjectDialog";
import SyncButton from "./SyncButton";
import ProjectNode from "./flow/ProjectNode";
import ZoneNode from "./flow/ZoneNode";
import FlowEdge, { ArrowMarkers } from "./flow/FlowEdge";
import { CARD_H, CARD_W, computeLayout, relatedProjects } from "@/lib/layout";
import type { Connection, MasterPlanData, Project } from "@/lib/types";

const nodeTypes = { project: ProjectNode, zone: ZoneNode };
const edgeTypes = { flow: FlowEdge };

export default function MasterPlan({ initialData }: { initialData: MasterPlanData }) {
  return (
    <ReactFlowProvider>
      <Sheet initialData={initialData} />
    </ReactFlowProvider>
  );
}

function Sheet({ initialData }: { initialData: MasterPlanData }) {
  const { mode, session } = useMode();
  const { fitView } = useReactFlow();

  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [focusScope, setFocusScope] = useState<FocusScope>("DIRECT");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [showNewConnection, setShowNewConnection] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const positions = useRef(new Map<string, { x: number; y: number }>());

  const editing = mode === "EDIT";
  const presenting = mode === "PRESENT";
  const isAdmin = session.role === "ADMIN";
  const editableIds = useMemo(() => new Set(data.editableProjectIds), [data.editableProjectIds]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/master-plan");
    if (response.ok) setData(await response.json());
  }, []);

  // ---- indexes ----------------------------------------------------------
  const projectsById = useMemo(
    () => new Map(data.projects.map((p) => [p.project_id, p])),
    [data.projects]
  );
  /** connection_type → colour, so a line and its label share one hue. */
  const connectionColours = useMemo(
    () => new Map(data.connectionTypes.map((t) => [t.type_id, t.color])),
    [data.connectionTypes]
  );

  const departmentsByCode = useMemo(
    () => new Map(data.departments.map((d) => [d.dept_code, d])),
    [data.departments]
  );
  const statusById = useMemo(
    () => new Map(data.statuses.map((s) => [s.status_id, s])),
    [data.statuses]
  );

  // ---- filtering --------------------------------------------------------
  const visibleProjects = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return data.projects.filter((project) => {
      if (filters.departments.size && !filters.departments.has(project.dept_code)) return false;
      if (filters.statuses.size && !filters.statuses.has(project.status_id)) return false;
      if (filters.futureOnly && project.project_type !== "FUTURE_ADDON") return false;
      if (!needle) return true;
      return [
        project.project_id,
        project.project_name,
        project.owner_name,
        project.brief,
        project.objective,
        project.next_step,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [data.projects, filters]);

  const visibleProjectIds = useMemo(
    () => new Set(visibleProjects.map((p) => p.project_id)),
    [visibleProjects]
  );

  const visibleConnections = useMemo(() => {
    if (filters.connectionView === "NONE") return [];
    return data.connections.filter((connection) => {
      if (connection.connection_status === "REJECTED") return false;
      if (
        filters.connectionView === "CONFIRMED" &&
        connection.connection_status !== "APPROVED" &&
        connection.connection_status !== "EDITED"
      ) {
        return false;
      }
      if (
        filters.connectionView === "SUGGESTED" &&
        connection.connection_status !== "AI_SUGGESTED"
      ) {
        return false;
      }
      if (filters.types.size && !filters.types.has(connection.connection_type)) return false;
      return (
        visibleProjectIds.has(connection.source_project_id) &&
        visibleProjectIds.has(connection.target_project_id)
      );
    });
  }, [data.connections, filters, visibleProjectIds]);

  // ---- focus highlighting (§19) -----------------------------------------
  const focusSet = useMemo(() => {
    if (!selectedProject) return null;
    return relatedProjects(
      selectedProject,
      visibleConnections.map((c) => ({
        source: c.source_project_id,
        target: c.target_project_id,
        bidirectional: c.direction === "BIDIRECTIONAL",
      })),
      focusScope
    );
  }, [selectedProject, visibleConnections, focusScope]);

  // ---- nodes and edges --------------------------------------------------
  const layout = useMemo(
    () => computeLayout(data.departments, data.projects),
    [data.departments, data.projects]
  );

  const derivedNodes = useMemo<Node[]>(() => {
    const zoneNodes: Node[] = layout.zones
      .filter((zone) => visibleProjects.some((p) => p.dept_code === zone.dept.dept_code))
      .map((zone) => ({
        id: zone.id,
        type: "zone",
        position: { x: zone.x, y: zone.y },
        // Every box on this sheet has a known size, so declare it and skip the
        // measurement flicker on first paint.
        initialWidth: zone.width,
        initialHeight: zone.height,
        data: {
          dept: zone.dept,
          width: zone.width,
          height: zone.height,
          count: zone.count,
          shown: visibleProjects.filter((p) => p.dept_code === zone.dept.dept_code).length,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 0,
      }));

    const cardNodes: Node[] = visibleProjects.map((project) => {
      const box = layout.cards.get(project.project_id) ?? { x: 0, y: 0 };
      const live = positions.current.get(project.project_id);
      return {
        id: project.project_id,
        type: "project",
        position: live ?? { x: box.x, y: box.y },
        initialWidth: CARD_W,
        initialHeight: CARD_H,
        data: {
          project,
          status: statusById.get(project.status_id),
          deptColor: departmentsByCode.get(project.dept_code)?.color ?? "#94a3b8",
          selected: selectedProject === project.project_id,
          faded: !!focusSet && !focusSet.has(project.project_id),
          editable: editableIds.has(project.project_id),
        },
        draggable: isAdmin && editing,
        // Cards sit above every edge. See the layering note in globals.css.
        zIndex: selectedProject === project.project_id ? 20 : 5,
      };
    });

    return [...zoneNodes, ...cardNodes];
  }, [
    layout,
    visibleProjects,
    statusById,
    departmentsByCode,
    selectedProject,
    focusSet,
    editableIds,
    isAdmin,
    editing,
  ]);

  /**
   * Card rectangles for label placement. One array shared by every edge, so the
   * edges' useMemo is not invalidated per-edge, and rebuilt only when the cards
   * themselves move.
   */
  const cardObstacles = useMemo(
    () =>
      visibleProjects.map((project) => {
        const box = layout.cards.get(project.project_id) ?? { x: 0, y: 0 };
        const live = positions.current.get(project.project_id);
        const at = live ?? box;
        return { x: at.x, y: at.y, w: CARD_W, h: CARD_H };
      }),
    [visibleProjects, layout]
  );

  const edges = useMemo<Edge[]>(
    () =>
      visibleConnections.map((connection) => {
        const touchesSelection =
          !!selectedProject &&
          (connection.source_project_id === selectedProject ||
            connection.target_project_id === selectedProject);
        const withinFocus =
          !focusSet ||
          (focusSet.has(connection.source_project_id) &&
            focusSet.has(connection.target_project_id));

        return {
          id: connection.connection_id,
          source: connection.source_project_id,
          target: connection.target_project_id,
          type: "flow",
          selected: selectedConnection === connection.connection_id,
          // Below the cards (5) and above the department zones (0). A selected
          // edge lifts clear of its neighbours but still never covers a card:
          // if a line has to pass where a card is, the card wins and hides it.
          zIndex: touchesSelection ? 2 : 1,
          data: {
            label: connection.connection_label,
            reviewState:
              connection.connection_status === "APPROVED" ||
              connection.connection_status === "EDITED"
                ? "CONFIRMED"
                : connection.connection_status === "AI_SUGGESTED"
                  ? "AI_SUGGESTED"
                  : "NOT_REVIEWED",
            bidirectional: connection.direction === "BIDIRECTIONAL",
            dimmed: !withinFocus,
            emphasised: touchesSelection || selectedConnection === connection.connection_id,
            accent: connectionColours.get(connection.connection_type) ?? "",
            obstacles: cardObstacles,
          },
        };
      }),
    [
      visibleConnections,
      selectedProject,
      selectedConnection,
      focusSet,
      connectionColours,
      cardObstacles,
    ]
  );

  /*
   * React Flow owns the node array so that it can write measured sizes back
   * into it — without that, it never reports the nodes as initialised and
   * refuses to draw a single edge. Content still comes from `derivedNodes`;
   * this effect folds it in while preserving what React Flow measured and any
   * position the user has dragged to.
   */
  const [flowNodes, setFlowNodes, applyNodeChanges] = useNodesState<Node>([]);

  useEffect(() => {
    setFlowNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      return derivedNodes.map((node) => {
        const existing = byId.get(node.id);
        if (!existing) return node;
        return {
          ...node,
          measured: existing.measured,
          // Keep the dragged position; fall back to the computed slot.
          position: positions.current.get(node.id) ?? node.position,
        };
      });
    });
  }, [derivedNodes, setFlowNodes]);

  // ---- layout persistence ----------------------------------------------
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      if (isAdmin && editing) {
        for (const change of changes) {
          if (change.type === "position" && change.position) {
            positions.current.set(change.id, change.position);
            if (change.dragging === false) setLayoutDirty(true);
          }
        }
      }
      // Always applied: this is also how React Flow receives measurements.
      applyNodeChanges(changes);
    },
    [isAdmin, editing, applyNodeChanges]
  );

  async function saveLayout() {
    const payload = [...positions.current.entries()].map(([id, p]) => ({
      id,
      x: p.x,
      y: p.y,
    }));
    const response = await fetch("/api/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: payload }),
    });
    if (response.ok) {
      setLayoutDirty(false);
      await refresh();
    }
  }

  async function resetLayout() {
    if (!confirm("Reset every card to its automatic position?")) return;
    const response = await fetch("/api/layout", { method: "DELETE" });
    if (response.ok) {
      positions.current.clear();
      setLayoutDirty(false);
      await refresh();
    }
  }

  // Leaving edit mode drops any unsaved drag so the sheet cannot silently
  // diverge from what is stored.
  useEffect(() => {
    if (!editing && layoutDirty) {
      positions.current.clear();
      setLayoutDirty(false);
    }
  }, [editing, layoutDirty]);

  const selectedProjectRecord = selectedProject ? projectsById.get(selectedProject) : undefined;
  const selectedConnectionRecord: Connection | undefined = selectedConnection
    ? data.connections.find((c) => c.connection_id === selectedConnection)
    : undefined;

  const pendingSuggestions = data.connections.filter(
    (c) => c.connection_status === "AI_SUGGESTED"
  ).length;
  const approvedConnections = data.connections.filter(
    (c) => c.connection_status === "APPROVED" || c.connection_status === "EDITED"
  ).length;

  function selectProject(projectId: string) {
    setSelectedConnection(null);
    setSelectedProject(projectId);
  }

  return (
    <div className="h-full flex">
      {!presenting && (
        <FilterRail
          departments={data.departments}
          statuses={data.statuses}
          connectionTypes={data.connectionTypes}
          filters={filters}
          onChange={setFilters}
          focusScope={focusScope}
          onFocusScopeChange={setFocusScope}
          hasSelection={!!selectedProject}
          counts={{
            projects: visibleProjects.length,
            totalProjects: data.projects.length,
            edges: visibleConnections.length,
            totalEdges: data.connections.filter((c) => c.connection_status !== "REJECTED").length,
          }}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* toolbar */}
        <div className="shrink-0 h-9 border-b border-rule bg-sheet-raised flex items-center gap-2 px-3 hide-when-presenting">
          <span className="anno">
            {selectedProjectRecord
              ? `Focused on ${selectedProjectRecord.project_id}`
              : "Nothing selected"}
          </span>
          {(selectedProject || selectedConnection) && (
            <button
              className="anno underline underline-offset-2"
              onClick={() => {
                setSelectedProject(null);
                setSelectedConnection(null);
              }}
            >
              Clear
            </button>
          )}

          <div className="flex-1" />

          {editing && (
            <>
              {isAdmin && (
                <button className="btn btn-quiet" onClick={() => setShowNewProject(true)}>
                  Add project
                </button>
              )}
              <button className="btn btn-quiet" onClick={() => setShowNewConnection(true)}>
                Add connection
              </button>
              {isAdmin && (
                <>
                  <button className="btn btn-quiet" onClick={resetLayout}>
                    Reset layout
                  </button>
                  <button
                    className={layoutDirty ? "btn btn-solid" : "btn btn-quiet"}
                    disabled={!layoutDirty}
                    onClick={saveLayout}
                  >
                    {layoutDirty ? "Save layout" : "Layout saved"}
                  </button>
                </>
              )}
            </>
          )}
          <SyncButton canSync={isAdmin} onSynced={refresh} />

          <button className="btn btn-quiet" onClick={() => fitView({ padding: 0.12 })}>
            Fit sheet
          </button>
        </div>

        <div className="flex-1 min-h-0 relative">
          <ArrowMarkers colors={[...connectionColours.values()]} />
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => {
              if (node.type === "project") selectProject(node.id);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedProject(null);
              setSelectedConnection(edge.id);
            }}
            onPaneClick={() => {
              setSelectedProject(null);
              setSelectedConnection(null);
            }}
            nodesDraggable={isAdmin && editing}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.12}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            proOptions={{ hideAttribution: true }}
            className="sheet-grid"
          >
            <Background variant={BackgroundVariant.Dots} gap={100} size={0} color="transparent" />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>

          <TitleBlock
            departments={data.departments}
            statuses={data.statuses}
            drawnBy={session.displayName}
            projectCount={data.projects.length}
            approvedConnections={approvedConnections}
            pendingSuggestions={pendingSuggestions}
          />
        </div>
      </div>

      {/* inspector */}
      {(selectedProjectRecord || selectedConnectionRecord) && (
        <aside className="w-[368px] shrink-0 border-l-2 border-ink bg-sheet-raised overflow-hidden">
          {selectedProjectRecord ? (
            <ProjectInspector
              project={selectedProjectRecord}
              department={departmentsByCode.get(selectedProjectRecord.dept_code)}
              statuses={data.statuses}
              connectionTypes={data.connectionTypes}
              connections={data.connections.filter(
                (c) =>
                  c.connection_status !== "REJECTED" &&
                  (c.source_project_id === selectedProjectRecord.project_id ||
                    c.target_project_id === selectedProjectRecord.project_id)
              )}
              projects={projectsById}
              editable={editableIds.has(selectedProjectRecord.project_id)}
              editing={editing}
              onClose={() => setSelectedProject(null)}
              onSaved={refresh}
              onSelectConnection={(id) => {
                setSelectedProject(null);
                setSelectedConnection(id);
              }}
              onSelectProject={selectProject}
            />
          ) : selectedConnectionRecord ? (
            <ConnectionInspector
              connection={selectedConnectionRecord}
              projects={projectsById}
              departments={departmentsByCode}
              connectionTypes={data.connectionTypes}
              session={session}
              editable={
                isAdmin ||
                editableIds.has(selectedConnectionRecord.source_project_id) ||
                editableIds.has(selectedConnectionRecord.target_project_id)
              }
              editing={editing}
              onClose={() => setSelectedConnection(null)}
              onChanged={refresh}
              onSelectProject={selectProject}
            />
          ) : null}
        </aside>
      )}

      {showNewConnection && (
        <NewConnectionDialog
          projects={data.projects}
          connectionTypes={data.connectionTypes}
          editableProjectIds={editableIds}
          session={session}
          initialSource={selectedProject ?? undefined}
          onClose={() => setShowNewConnection(false)}
          onCreated={refresh}
        />
      )}

      {showNewProject && (
        <NewProjectDialog
          departments={data.departments}
          statuses={data.statuses}
          projects={data.projects}
          onClose={() => setShowNewProject(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}

export type { Project };
