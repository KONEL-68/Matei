-- Change cntr_value from BIGINT to DOUBLE PRECISION
-- Rate counters (e.g. Batch Requests/sec) produce float values like 1.49

ALTER TABLE perf_counters_raw
    ALTER COLUMN cntr_value TYPE DOUBLE PRECISION;
