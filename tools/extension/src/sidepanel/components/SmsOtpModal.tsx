import { useState } from 'react';

interface Props {
  onConfirm: (input: { sender: string; pattern: string }) => void;
  onCancel: () => void;
}

export function SmsOtpModal({ onConfirm, onCancel }: Props) {
  const [sender, setSender] = useState('');
  const [pattern, setPattern] = useState('\\d{6}');

  const handleConfirm = () => {
    onConfirm({ sender: sender.trim(), pattern: pattern.trim() || '\\d{6}' });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Insert smscli OTP step</h3>
        <p className="modal-desc">
          A new <code>tool_call</code> step will be inserted before this one. It calls{' '}
          <code>smscli get-otp</code> with the given sender and regex pattern, and stores the
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
          <span>Regex pattern</span>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="\d{6}"
          />
        </label>
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
