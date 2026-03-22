-- Scheduler stats from sys.dm_os_schedulers
-- Source: sys.dm_os_schedulers
-- Collection frequency: 30s (collected alongside perf_counters)
-- Type: instantaneous snapshot
-- Stored as perf_counter with counter_name = 'Pending Tasks'
-- Validation: SELECT SUM(runnable_tasks_count + pending_disk_io_count + work_queue_count) FROM sys.dm_os_schedulers WHERE scheduler_id < 255 AND is_online = 1

SELECT
    SUM(runnable_tasks_count) AS runnable_tasks,
    SUM(pending_disk_io_count) AS pending_disk_io,
    SUM(work_queue_count) AS work_queue
FROM sys.dm_os_schedulers
WHERE scheduler_id < 255
  AND is_online = 1
