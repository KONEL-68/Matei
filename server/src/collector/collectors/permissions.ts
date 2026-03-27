import type sql from 'mssql';

export interface PermissionsRow {
  role_name: string;
  login_name: string;
  login_type: string;
}

const QUERY = `
SELECT
    r.name AS role_name,
    m.name AS login_name,
    CASE m.type
        WHEN 'U' THEN 'Windows login'
        WHEN 'G' THEN 'Active Directory account'
        WHEN 'S' THEN 'SQL login'
        WHEN 'C' THEN 'Certificate'
        WHEN 'K' THEN 'Asymmetric key'
        ELSE 'Unknown'
    END AS login_type
FROM sys.server_role_members srm
JOIN sys.server_principals r ON srm.role_principal_id = r.principal_id
JOIN sys.server_principals m ON srm.member_principal_id = m.principal_id
WHERE r.name IN ('sysadmin','serveradmin','securityadmin','processadmin','setupadmin','bulkadmin','diskadmin','dbcreator')
ORDER BY r.name, m.name
`;

export async function collectPermissions(request: sql.Request): Promise<PermissionsRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as PermissionsRow[];
}
