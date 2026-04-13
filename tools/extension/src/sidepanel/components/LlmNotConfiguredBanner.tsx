import { useHasActiveProvider } from '../hooks/useLlm';

/**
 * Banner shown at the top of the side panel when no LLM provider is
 * configured. Offers a one-click button to open the extension options page.
 * Returns null once a provider is active.
 */
export function LlmNotConfiguredBanner() {
  const hasProvider = useHasActiveProvider();

  if (hasProvider) return null;

  const handleConfigure = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <section className="llm-banner">
      <div className="llm-banner-body">
        <strong>LLM features are disabled.</strong>
        <span>
          Configure an LLM provider to enable selector improvement, AI guidance
          generation, and auto-fill metadata.
        </span>
      </div>
      <button className="btn-primary btn-small-inline" onClick={handleConfigure} type="button">
        Configure LLM
      </button>
    </section>
  );
}
