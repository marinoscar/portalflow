import { useState } from 'react';

interface Props {
  onConfirm: (input: { sender: string; timeout: string }) => void;
  onCancel: () => void;
}

export function SmsOtpModal({ onConfirm, onCancel }: Props) {
  const [sender, setSender] = useState('');
  const [timeout, setTimeout] = useState('60');

  const handleConfirm = () => {
    const t = parseInt(timeout, 10);
    const validTimeout = !isNaN(t) && t > 0 ? String(t) : '60';
    onConfirm({ sender: sender.trim(), timeout: validTimeout });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Insert smscli OTP step</h3>
        <p className="modal-desc">
          A new <code>tool_call</code> step will be inserted before this one. It calls{' '}
          <code>smscli otp wait --json</code> with the given sender and timeout, and stores the
          captured code as <code>otpCode</code> for the next step to use.
        </p>
        <label className="field">
          <span>Expected sender (optional)</span>
          <input
            type="text"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="ExampleCarrier"
          />
        </label>
        <label className="field">
          <span>Timeout (seconds)</span>
          <input
            type="number"
            value={timeout}
            onChange={(e) => setTimeout(e.target.value)}
            placeholder="60"
            min={1}
          />
        </label>
        <p className="hint-small">
          On timeout, the runtime automatically falls back to{' '}
          <code>smscli otp latest</code> with the same sender filter, in case the SMS arrived
          just after the wait window closed.
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleConfirm}>
            Insert OTP step
          </button>
        </div>
      </div>
    </div>
  );
}
