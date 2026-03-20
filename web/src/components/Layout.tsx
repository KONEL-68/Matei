import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { authFetch, logout } from '@/lib/auth';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/instances', label: 'Instances' },
  { to: '/alerts', label: 'Alerts' },
];

export function Layout() {
  const { theme, toggleTheme } = useTheme();

  const { data: alertCount } = useQuery<{ count: number }>({
    queryKey: ['alertCount'],
    queryFn: () => authFetch('/api/alerts/count').then((r) => r.json()),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      <aside className="w-56 bg-gray-900 text-gray-100 flex flex-col dark:border-r dark:border-gray-800">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-xl font-bold tracking-tight">Matei</h1>
          <p className="text-xs text-gray-400 mt-0.5">SQL Server Monitoring</p>
        </div>
        <nav className="flex-1 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center justify-between px-4 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-gray-800 text-white font-medium'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                )
              }
            >
              {item.label}
              {item.to === '/alerts' && alertCount && alertCount.count > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-medium text-white">
                  {alertCount.count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-700 p-3 space-y-1">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
