import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InstanceForm, type InstanceFormData } from '@/components/InstanceForm';
import { authFetch } from '@/lib/auth';

interface Instance {
  id: number;
  name: string;
  host: string;
  port: number;
  auth_type: string;
  status: string;
  last_seen: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface TestResult {
  ok: boolean;
  error?: string;
  health?: Record<string, unknown>;
}

const API = '/api/instances';

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function Instances() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editInstance, setEditInstance] = useState<Instance | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: instances = [], isLoading } = useQuery<Instance[]>({
    queryKey: ['instances'],
    queryFn: () => fetchJson<Instance[]>(API),
  });

  const createMutation = useMutation({
    mutationFn: (data: InstanceFormData) =>
      fetchJson(API, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: InstanceFormData }) =>
      fetchJson(`${API}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetchJson(`${API}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      setDeleteConfirm(null);
    },
  });

  const testSavedMutation = useMutation({
    mutationFn: (id: number) => fetchJson<TestResult>(`${API}/${id}/test`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
  });

  function closeModal() {
    setModal(null);
    setEditInstance(null);
    setTestResult(null);
  }

  function openEdit(inst: Instance) {
    setEditInstance(inst);
    setTestResult(null);
    setModal('edit');
  }

  async function handleTest(data: InstanceFormData) {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await fetchJson<TestResult>(`${API}/test`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setIsTesting(false);
    }
  }

  function statusDot(status: string) {
    const colors: Record<string, string> = {
      online: 'bg-green-500',
      unreachable: 'bg-red-500',
      unknown: 'bg-gray-400',
    };
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors[status] ?? colors.unknown}`} />
        <span className="capitalize">{status}</span>
      </span>
    );
  }

  function formatLastSeen(lastSeen: string | null) {
    if (!lastSeen) return 'Never';
    const d = new Date(lastSeen);
    const now = Date.now();
    const diffS = Math.floor((now - d.getTime()) / 1000);
    if (diffS < 60) return `${diffS}s ago`;
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return d.toLocaleDateString();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Instances</h2>
        <button
          onClick={() => { setModal('add'); setTestResult(null); }}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add Instance
        </button>
      </div>

      {/* Modal overlay */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900 dark:border dark:border-gray-700">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {modal === 'add' ? 'Add Instance' : 'Edit Instance'}
            </h3>
            <InstanceForm
              initial={
                editInstance
                  ? {
                      name: editInstance.name,
                      host: editInstance.host,
                      port: editInstance.port,
                      auth_type: editInstance.auth_type as 'sql' | 'windows',
                    }
                  : undefined
              }
              onSubmit={(data) => {
                if (modal === 'edit' && editInstance) {
                  updateMutation.mutate({ id: editInstance.id, data });
                } else {
                  createMutation.mutate(data);
                }
              }}
              onCancel={closeModal}
              onTest={handleTest}
              isSubmitting={createMutation.isPending || updateMutation.isPending}
              isTesting={isTesting}
              testResult={testResult}
            />
            {(createMutation.error || updateMutation.error) && (
              <p className="mt-3 text-sm text-red-600">
                {(createMutation.error ?? updateMutation.error)?.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900 dark:border dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete Instance</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              This will permanently delete this instance and all its collected data. Continue?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : instances.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No instances registered yet. Click "Add Instance" to get started.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Host</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {instances.map((inst) => (
                <tr key={inst.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{inst.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{inst.host}:{inst.port}</td>
                  <td className="px-4 py-3">{statusDot(inst.status)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatLastSeen(inst.last_seen)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => testSavedMutation.mutate(inst.id)}
                        disabled={testSavedMutation.isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                        title="Test connection"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => openEdit(inst)}
                        className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(inst.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
