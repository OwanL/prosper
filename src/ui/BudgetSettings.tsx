import type { AppSnapshot } from '../shared/types';
import { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';

export function BudgetPanel({
  snapshot,
  unavailable,
  apply,
}: {
  snapshot: AppSnapshot;
  unavailable: boolean;
  apply: (maxRequests: number, maxTokens: number) => Promise<void>;
}) {
  const budget = snapshot.budget;
  const [requests, setRequests] = useState(String(budget.limit));
  const [tokens, setTokens] = useState(
    budget.maxTokens === undefined ? '' : String(budget.maxTokens),
  );
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setRequests(String(budget.limit));
      setTokens(budget.maxTokens === undefined ? '' : String(budget.maxTokens));
    }
  }, [budget.limit, budget.maxTokens, dirty]);
  const valid = (text: string) => /^\d+$/.test(text) && Number.isSafeInteger(Number(text));
  const blocked = budget.blocked;
  return (
    <div className="budget-panel">
      <Tooltip content="Requests are durably reserved before provider dispatch, including interrupted requests. Pending requests are already included in both totals. Caps are cumulative, not remaining allowances.">
        <p className="budget-totals">
          <b>
            Requests {budget.requests.toLocaleString()} / {budget.limit.toLocaleString()}
          </b>
          <span>{budget.pending.toLocaleString()} pending</span>
        </p>
      </Tooltip>
      <Tooltip content="Charged/reserved tokens include input estimates plus maximum output for pending calls. Actual reported usage replaces reservations when available; interrupted calls or missing usage remain conservatively charged at the reservation. These are token counts, not dollars.">
        <p className="budget-totals">
          <b>
            Tokens {budget.tokens?.toLocaleString() ?? 'unavailable'} /{' '}
            {budget.maxTokens?.toLocaleString() ?? 'unavailable'}
          </b>
          <span>Charged / reserved</span>
        </p>
      </Tooltip>
      {blocked && (
        <div className="budget-blocked" role="status" data-testid="reasoning-blocked">
          <Tooltip content={blocked.message}>
            <strong>
              Live reasoning blocked · {blocked.reason === 'tokens' ? 'token cap' : 'request cap'}
            </strong>
          </Tooltip>
          <p>
            Next request needs {blocked.requestedTokens.toLocaleString()} tokens;{' '}
            {blocked.remainingTokens.toLocaleString()} remain.
          </p>
          <p>
            World clock {snapshot.status.running ? 'running; physical work continues' : 'paused'}.
            New live requests paused.
          </p>
        </div>
      )}
      <details className="budget-settings">
        <summary>Budget settings · total caps</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setFailed(false);
            if (!valid(requests) || !valid(tokens)) {
              setFailed(true);
              setMessage('Enter nonnegative whole-number caps within the safe integer range.');
              return;
            }
            try {
              await apply(Number(requests), Number(tokens));
              setDirty(false);
              setMessage(
                'Budget applied. Prior usage and world retained; a paused run stays paused.',
              );
            } catch (error) {
              setFailed(true);
              setMessage(
                `Budget not confirmed: ${error instanceof Error ? error.message : String(error)}. Check connection and refreshed totals, then retry Apply budget.`,
              );
            }
          }}
        >
          <label>
            Total request cap
            <Tooltip content="Maximum cumulative requests, including prior and pending requests. Zero permits no new requests; it is not unlimited.">
              <input
                type="number"
                min="0"
                step="1"
                max={Number.MAX_SAFE_INTEGER}
                value={requests}
                onChange={(e) => {
                  setRequests(e.target.value);
                  setDirty(true);
                  setMessage('');
                }}
              />
            </Tooltip>
          </label>
          <label>
            Total token cap
            <Tooltip content="Maximum cumulative charged/reserved tokens. A new request must fit its full input estimate plus maximum output, even if requests remain. Zero is not unlimited.">
              <input
                type="number"
                min="0"
                step="1"
                max={Number.MAX_SAFE_INTEGER}
                value={tokens}
                onChange={(e) => {
                  setTokens(e.target.value);
                  setDirty(true);
                  setMessage('');
                }}
              />
            </Tooltip>
          </label>
          <p className="muted">
            Total caps, not extra allowances. Keeps all prior usage; never resets the world. Zero
            blocks new requests. Applying sufficient caps resumes live reasoning only if the world
            is running.
          </p>
          <p className="muted">
            A request reserves estimated input + maximum output. Missing usage or interrupted calls
            remain conservatively charged; tokens are not dollar costs.
          </p>
          <Tooltip
            content={`Apply these total caps explicitly without resetting usage or the world.${unavailable ? ' Disabled: backend unavailable, runtime not ready, or a command is in progress.' : ''}`}
          >
            <button disabled={unavailable}>Apply budget</button>
          </Tooltip>
          {message && (
            <p
              className={failed ? 'error budget-message' : 'budget-message'}
              role={failed ? 'alert' : 'status'}
            >
              {message}
            </p>
          )}
        </form>
      </details>
    </div>
  );
}
