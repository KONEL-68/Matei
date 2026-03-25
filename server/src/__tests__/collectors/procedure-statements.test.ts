import { describe, it, expect } from 'vitest';
import {
  collectProcedureStatements,
  type ProcedureStatementRow,
} from '../../collector/collectors/procedure-stats.js';

describe('collectProcedureStatements', () => {
  it('returns mapped statement rows from SQL Server recordset', async () => {
    const mockRequest = {
      query: async () => ({
        recordset: [
          {
            database_id: 5,
            object_id: 1001,
            database_name: 'testdb',
            procedure_name: 'dbo.usp_GetOrders',
            statement_start_offset: 0,
            statement_text: 'SELECT * FROM Orders',
            execution_count: 150,
            total_cpu_ms: 3000,
            total_elapsed_ms: 5000,
            physical_reads: 200,
            logical_reads: 8000,
            logical_writes: 50,
            avg_cpu_ms: 20.0,
            avg_elapsed_ms: 33.3,
            min_grant_kb: 512,
            last_grant_kb: 1024,
          },
          {
            database_id: 5,
            object_id: 1001,
            database_name: 'testdb',
            procedure_name: 'dbo.usp_GetOrders',
            statement_start_offset: 128,
            statement_text: 'INSERT INTO OrderLog VALUES(@id)',
            execution_count: 150,
            total_cpu_ms: 500,
            total_elapsed_ms: 800,
            physical_reads: 10,
            logical_reads: 300,
            logical_writes: 150,
            avg_cpu_ms: 3.3,
            avg_elapsed_ms: 5.3,
            min_grant_kb: null,
            last_grant_kb: null,
          },
        ],
      }),
    } as never;

    const result = await collectProcedureStatements(mockRequest);

    expect(result).toHaveLength(2);

    expect(result[0].database_name).toBe('testdb');
    expect(result[0].procedure_name).toBe('dbo.usp_GetOrders');
    expect(result[0].statement_start_offset).toBe(0);
    expect(result[0].statement_text).toBe('SELECT * FROM Orders');
    expect(result[0].execution_count).toBe(150);
    expect(result[0].total_cpu_ms).toBe(3000);
    expect(result[0].physical_reads).toBe(200);
    expect(result[0].logical_reads).toBe(8000);
    expect(result[0].avg_cpu_ms).toBe(20.0);
    expect(result[0].min_grant_kb).toBe(512);
    expect(result[0].last_grant_kb).toBe(1024);

    expect(result[1].statement_start_offset).toBe(128);
    expect(result[1].min_grant_kb).toBeNull();
    expect(result[1].last_grant_kb).toBeNull();
  });

  it('returns empty array when no procedures found', async () => {
    const mockRequest = {
      query: async () => ({
        recordset: [],
      }),
    } as never;

    const result = await collectProcedureStatements(mockRequest);
    expect(result).toHaveLength(0);
  });
});
