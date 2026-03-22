import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

export interface InstanceFormData {
  name: string;
  host: string;
  port: number;
  auth_type: 'sql' | 'windows';
  username: string;
  password: string;
  group_id: number | null;
}

interface GroupOption {
  id: number;
  name: string;
}

interface InstanceFormProps {
  initial?: Partial<InstanceFormData>;
  onSubmit: (data: InstanceFormData) => void;
  onCancel: () => void;
  onTest: (data: InstanceFormData) => void;
  isSubmitting: boolean;
  isTesting: boolean;
  testResult: { ok: boolean; error?: string; health?: Record<string, unknown> } | null;
}

const defaultData: InstanceFormData = {
  name: '',
  host: '',
  port: 1433,
  auth_type: 'sql',
  username: '',
  password: '',
  group_id: null,
};

export function InstanceForm({ initial, onSubmit, onCancel, onTest, isSubmitting, isTesting, testResult }: InstanceFormProps) {
  const [form, setForm] = useState<InstanceFormData>({ ...defaultData, ...initial });

  const { data: groups = [] } = useQuery<GroupOption[]>({
    queryKey: ['groups-list'],
    queryFn: async () => {
      const res = await authFetch('/api/groups');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const set = (field: keyof InstanceFormData, value: string | number | null) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          placeholder="Production Server 1"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Host</label>
          <input
            type="text"
            required
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            placeholder="192.168.1.100 or sqlserver.domain.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Port</label>
          <input
            type="number"
            value={form.port}
            onChange={(e) => set('port', parseInt(e.target.value, 10) || 1433)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Authentication</label>
        <select
          value={form.auth_type}
          onChange={(e) => set('auth_type', e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="sql">SQL Server Authentication</option>
          <option value="windows">Windows Authentication</option>
        </select>
      </div>

      {groups.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Group</label>
          <select
            value={form.group_id ?? ''}
            onChange={(e) => set('group_id', e.target.value ? parseInt(e.target.value, 10) : null)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {form.auth_type === 'sql' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="sa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        </div>
      )}

      {testResult && (
        <div className={`rounded p-3 text-sm ${testResult.ok ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'}`}>
          {testResult.ok ? (
            <div>
              <p className="font-medium">Connection successful</p>
              {testResult.health && (
                <div className="mt-1 text-xs space-y-0.5">
                  <p>Server: {String(testResult.health.instance_name)}</p>
                  <p>Version: {String(testResult.health.version)} ({String(testResult.health.edition)})</p>
                  <p>Uptime: {Math.floor(Number(testResult.health.uptime_seconds) / 3600)}h {Math.floor((Number(testResult.health.uptime_seconds) % 3600) / 60)}m</p>
                  <p>CPUs: {String(testResult.health.cpu_count)} | Memory: {String(testResult.health.physical_memory_mb)} MB</p>
                </div>
              )}
            </div>
          ) : (
            <p>Connection failed: {testResult.error}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => onTest(form)}
          disabled={isTesting || !form.host}
          className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
