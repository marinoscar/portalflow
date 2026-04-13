import { useEffect, useState } from 'react';
import {
  PROVIDER_PRESETS,
  getPresetById,
  type ProviderKind,
} from '../shared/provider-kinds';
import {
  loadConfig,
  setProviderConfig,
  setActiveProvider,
  removeProvider,
  type ExtensionConfig,
  type ProviderConfig,
} from '../storage/config.storage';
import './app.css';

const CUSTOM_PRESET_ID = '__custom__';

type FormState = {
  name: string;
  kind: ProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
  presetId: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  kind: 'openai-compatible',
  apiKey: '',
  model: '',
  baseUrl: '',
  presetId: 'anthropic',
};

export function App() {
  const [config, setConfig] = useState<ExtensionConfig>({});
  const [form, setForm] = useState<FormState>(() => applyPreset('anthropic', EMPTY_FORM));
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    loadConfig().then(setConfig).catch(() => void 0);
  }, []);

  const handlePresetChange = (presetId: string) => {
    setForm(applyPreset(presetId, form));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert('Provider name is required');
      return;
    }
    setSaving(true);
    try {
      const providerConfig: ProviderConfig = {
        kind: form.kind,
        apiKey: form.apiKey.trim() || undefined,
        model: form.model.trim() || undefined,
        baseUrl: form.kind === 'openai-compatible' ? form.baseUrl.trim() || undefined : undefined,
      };
      await setProviderConfig(form.name.trim(), providerConfig);

      // Auto-activate the first provider saved
      const fresh = await loadConfig();
      if (!fresh.activeProvider) {
        await setActiveProvider(form.name.trim());
      }
      setConfig(await loadConfig());
      setEditingName(null);
      setForm(applyPreset('anthropic', EMPTY_FORM));
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (name: string) => {
    await setActiveProvider(name);
    setConfig(await loadConfig());
  };

  const handleRemove = async (name: string) => {
    if (!confirm(`Remove provider "${name}"? This deletes the stored API key.`)) return;
    await removeProvider(name);
    setConfig(await loadConfig());
  };

  const handleEdit = (name: string) => {
    const provider = config.providers?.[name];
    if (!provider) return;
    setEditingName(name);
    setForm({
      name,
      kind: provider.kind,
      apiKey: provider.apiKey ?? '',
      model: provider.model ?? '',
      baseUrl: provider.baseUrl ?? '',
      presetId: getPresetById(name) ? name : CUSTOM_PRESET_ID,
    });
  };

  const handleCancelEdit = () => {
    setEditingName(null);
    setForm(applyPreset('anthropic', EMPTY_FORM));
  };

  const configuredProviders = Object.entries(config.providers ?? {});

  return (
    <div className="options">
      <div className="banner">
        Your API key is stored in Chrome's local storage on this device only
        and never leaves your browser except to call the provider's API directly.
      </div>

      <h1>PortalFlow Recorder · Settings</h1>

      <section className="section">
        <h2>{editingName ? `Edit "${editingName}"` : 'Add a provider'}</h2>

        {!editingName && (
          <div className="field">
            <label>Preset</label>
            <select
              value={form.presetId}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value={CUSTOM_PRESET_ID}>Custom OpenAI-compatible</option>
            </select>
            {form.presetId !== CUSTOM_PRESET_ID && getPresetById(form.presetId)?.docsUrl && (
              <p className="hint-small">
                Get an API key at{' '}
                <a href={getPresetById(form.presetId)!.docsUrl} target="_blank" rel="noreferrer">
                  {getPresetById(form.presetId)!.docsUrl}
                </a>
              </p>
            )}
          </div>
        )}

        <div className="field">
          <label>Provider name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={!!editingName}
            placeholder="e.g., anthropic, my-proxy"
          />
        </div>

        <div className="field">
          <label>Kind</label>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ProviderKind })}
            disabled={form.presetId !== CUSTOM_PRESET_ID && !editingName}
          >
            <option value="anthropic">anthropic (native)</option>
            <option value="openai-compatible">openai-compatible</option>
          </select>
        </div>

        <div className="field">
          <label>API key</label>
          <div className="input-with-toggle">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={form.kind === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            />
            <button
              type="button"
              className="btn-ghost-small"
              onClick={() => setShowApiKey((s) => !s)}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className="field">
          <label>Model</label>
          <input
            type="text"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="claude-sonnet-4-20250514 / gpt-4o / etc."
          />
        </div>

        {form.kind === 'openai-compatible' && (
          <div className="field">
            <label>Base URL</label>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
        )}

        <div className="actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editingName ? 'Save changes' : 'Add provider'}
          </button>
          {editingName && (
            <button className="btn-secondary" onClick={handleCancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="section">
        <h2>Configured providers</h2>
        {configuredProviders.length === 0 ? (
          <p className="muted">No providers yet. Add one above to get started.</p>
        ) : (
          <ul className="provider-list">
            {configuredProviders.map(([name, provider]) => (
              <li key={name} className="provider-card">
                <div className="provider-header">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="activeProvider"
                      checked={config.activeProvider === name}
                      onChange={() => handleActivate(name)}
                    />
                    <strong>{name}</strong>
                    {config.activeProvider === name && <span className="active-tag">active</span>}
                  </label>
                  <div className="provider-actions">
                    <button className="btn-small" onClick={() => handleEdit(name)}>Edit</button>
                    <button className="btn-small btn-danger" onClick={() => handleRemove(name)}>Remove</button>
                  </div>
                </div>
                <div className="provider-details">
                  <span><strong>Kind:</strong> {provider.kind}</span>
                  <span><strong>Model:</strong> {provider.model ?? '—'}</span>
                  {provider.baseUrl && <span><strong>Base URL:</strong> {provider.baseUrl}</span>}
                  <span><strong>API key:</strong> {maskApiKey(provider.apiKey)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function applyPreset(presetId: string, base: FormState): FormState {
  if (presetId === CUSTOM_PRESET_ID) {
    return {
      ...base,
      presetId,
      name: '',
      kind: 'openai-compatible',
      apiKey: '',
      model: '',
      baseUrl: '',
    };
  }
  const preset = getPresetById(presetId);
  if (!preset) return { ...base, presetId };
  return {
    ...base,
    presetId,
    name: preset.id,
    kind: preset.kind,
    apiKey: '',
    model: preset.defaultModel,
    baseUrl: preset.baseUrl ?? '',
  };
}

function maskApiKey(key: string | undefined): string {
  if (!key) return '(not set)';
  if (key.length < 12) return `****${key.slice(-4)}`;
  return `${key.slice(0, 5)}${'*'.repeat(Math.min(key.length - 9, 8))}${key.slice(-4)}`;
}
