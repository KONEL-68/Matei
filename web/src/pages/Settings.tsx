import { useState } from 'react';
import { GroupsSettings } from '@/components/settings/GroupsSettings';
import { AlertsSettings } from '@/components/settings/AlertsSettings';
import { RetentionSettings } from '@/components/settings/RetentionSettings';
import { UsersSettings } from '@/components/settings/UsersSettings';
import { AboutSettings } from '@/components/settings/AboutSettings';

type Tab = 'groups' | 'alerts' | 'retention' | 'users' | 'about';

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'groups', label: 'Groups' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'retention', label: 'Retention' },
  { key: 'users', label: 'Users' },
  { key: 'about', label: 'About' },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('groups');

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h2>

      <div className="mt-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === 'groups' && <GroupsSettings />}
        {activeTab === 'alerts' && <AlertsSettings />}
        {activeTab === 'retention' && <RetentionSettings />}
        {activeTab === 'users' && <UsersSettings />}
        {activeTab === 'about' && <AboutSettings />}
      </div>
    </div>
  );
}
