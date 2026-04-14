import { useState } from 'react';

interface Props {
  onConfirm: (input: { vaultKey: string; inputName: string }) => void;
  onCancel: () => void;
}

export function VaultModal({ onConfirm, onCancel }: Props) {
  const [secretName, setSecretName] = useState('');
  const [inputName, setInputName] = useState('creds');

  const handleConfirm = () => {
    if (!secretName.trim() || !inputName.trim()) return;
    // Callback signature is retained for backward-compat with StepRow/App;
    // the first field is the vaultcli secret name, the second is the input
    // variable name that the runtime will populate (and explode per field).
    onConfirm({ vaultKey: secretName.trim(), inputName: inputName.trim() });
  };

  const preview = inputName.trim() || 'creds';

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Convert to vault credential</h3>
        <p className="modal-desc">
          This step will be rewritten to use an input with <code>source: &quot;vaultcli&quot;</code>.
          The runtime will call <code>vaultcli secrets get &lt;name&gt; --json</code> and expose
          every field of the secret as a context variable.
        </p>
        <label className="field">
          <span>Input name (context variable)</span>
          <input
            type="text"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            placeholder="creds"
          />
        </label>
        <label className="field">
          <span>Secret name (as stored in vaultcli)</span>
          <input
            type="text"
            value={secretName}
            onChange={(e) => setSecretName(e.target.value)}
            placeholder="att"
            autoFocus
          />
        </label>
        <p className="hint-small">
          Use the exploded fields in templates:{' '}
          <code>{`{{${preview}_username}}`}</code>, <code>{`{{${preview}_password}}`}</code>,
          etc. One variable per key in the secret&apos;s values object.
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!secretName.trim() || !inputName.trim()}
          >
            Convert
          </button>
        </div>
      </div>
    </div>
  );
}
