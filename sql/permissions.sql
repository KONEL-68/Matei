-- Fixed server role membership from sys.server_role_members and sys.server_principals
-- Source: sys.server_role_members, sys.server_principals
-- Permissions: VIEW SERVER STATE
-- Frequency: daily
-- Type: snapshot
-- Validation: SELECT COUNT(*) FROM sys.server_role_members

SELECT
    roles.name AS role_name,
    members.name AS login_name,
    CASE members.type
        WHEN 'U' THEN 'Windows login'
        WHEN 'G' THEN 'Active Directory account'
        WHEN 'S' THEN 'SQL login'
        WHEN 'C' THEN 'Certificate'
        WHEN 'K' THEN 'Asymmetric key'
        ELSE 'Unknown'
    END AS login_type
FROM sys.server_role_members srm
INNER JOIN sys.server_principals roles
    ON srm.role_principal_id = roles.principal_id
INNER JOIN sys.server_principals members
    ON srm.member_principal_id = members.principal_id
WHERE roles.name IN (
    'sysadmin',
    'serveradmin',
    'securityadmin',
    'processadmin',
    'setupadmin',
    'bulkadmin',
    'diskadmin',
    'dbcreator'
)
ORDER BY roles.name, members.name
