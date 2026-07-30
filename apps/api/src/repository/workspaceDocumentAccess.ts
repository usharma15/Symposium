import type { PoolClient } from "pg";

type ActorParameter = "$2" | "$3";

export const workspaceDocumentRoleSql = (actorParameter: ActorParameter) => `
  CASE GREATEST(
    CASE WHEN note.owner_handle = ${actorParameter} THEN 5 ELSE 0 END,
    CASE direct.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END,
    CASE inherited.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
  )
    WHEN 5 THEN 'owner'
    WHEN 4 THEN 'publisher'
    WHEN 3 THEN 'editor'
    WHEN 2 THEN 'commenter'
    ELSE 'viewer'
  END`;

export const workspaceDocumentAudienceHandles = async (client: PoolClient, noteId: string) => {
  const result = await client.query<{ handle: string }>(
    `SELECT owner_handle AS handle FROM notes WHERE id = $1
     UNION
     SELECT grantee_handle AS handle FROM workspace_note_grants WHERE note_id = $1
     UNION
     SELECT notebook_grant.grantee_handle AS handle
     FROM notes note
     JOIN workspace_notebook_grants notebook_grant ON notebook_grant.notebook_id = note.notebook_id
     WHERE note.id = $1`,
    [noteId]
  );
  return result.rows.map((row) => row.handle);
};

export const lockWorkspaceDocument = (client: PoolClient, noteId: string) =>
  client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('symposium:workspace-note:' || $1, 0))",
    [noteId]
  );
