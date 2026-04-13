import { useState } from 'react';

interface Props {
  onConfirm: (input: { vaultKey: string; inputName: string }) => void;
  onCancel: () => void;
}

export function VaultModal({ onConfirm, onCancel }: Props) {
  const [vaultKey, setVaultKey] = useState('');
  const [inputName, setInputName] = useState('password');

  const handleConfirm = () => {
    if (!vaultKey.trim() || !inputName.trim()) return;
    onConfirm({ vaultKey: vaultKey.trim(), inputName: inputName.trim() });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Convert to vault credential</h3>
        <p className="modal-desc">
          This step will be rewritten to use an input with <code>source: &quot;vaultcli&quot;</code>.
          The runtime will retrieve the value via <code>vaultcli get &lt;key&gt;</code>.
        </p>
        <label className="field">
          <span>Input name</span>
          <input
            type="text"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            placeholder="password"
          />
        </label>
        <label className="field">
          <span>Vault key path</span>
          <input
            type="text"
            value={vaultKey}
            onChange={(e) => setVaultKey(e.target.value)}
            placeholder="carrier/phone-account"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!vaultKey.trim() || !inputName.trim()}
          >
            Convert
          </button>
        </div>
      </div>
    </div>
  );
}
