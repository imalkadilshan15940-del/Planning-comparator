// ui/commentHistoryModal.js

import { getCommentHistory, addCommentHistoryEntry } from '../storage/commentHistoryRepo.js';
import { el } from './shell.js';
import { formatDateShort, formatIsoDateShort } from '../shared/dateUtils.js';

/**
 * @param row        { styleNo, trackingNumber, factoryLine } — the matching identity
 * @param onSaved    called after a new comment is saved, so the caller can
 *                   refresh the grid's comment-count icon without a full reload
 * @param options    { reportFilename, reportPrintedDate, cutoffDate }
 *                    - reportFilename/reportPrintedDate: tags any NEW comment
 *                      saved from this popup with the report it belongs to.
 *                    - cutoffDate: if given, only shows comments tagged with
 *                      a report date on or before this (used when opening a
 *                      Changed Style History record, so it shows only what
 *                      existed by that point in time). Omit for live forms,
 *                      which always show the complete thread.
 */
export async function showCommentHistoryModal(row, onSaved, options = {}) {
  const { reportFilename, reportPrintedDate, cutoffDate } = options;

  const existing = document.getElementById('comment-history-modal');
  if (existing) existing.remove();

  const modal = el(`
    <div class="modal-overlay" id="comment-history-modal">
      <div class="modal-box" style="max-width:560px;">
        <h3 style="margin-bottom:2px;">Comment History</h3>
        <p style="color:var(--slate); font-size:12.5px; margin-bottom:12px;">
          <span class="mono">${row.styleNo}</span> &middot; ${row.trackingNumber || '—'} &middot; ${row.factoryLine || '—'}
        </p>
        <div class="modal-list" id="ch-list" style="max-height:320px; margin-bottom:14px;"></div>
        <label style="font-size:12px; color:var(--slate); display:block; margin-bottom:4px;">New comment</label>
        <textarea id="ch-new-comment" rows="3" style="width:100%; padding:8px 10px; border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:6px; font-family:inherit; font-size:13px; resize:vertical; margin-bottom:10px;" placeholder="Add a comment…"></textarea>
        <div class="btn-row" style="justify-content:flex-end;">
          <button class="btn" id="ch-close">Close</button>
          <button class="btn btn-primary" id="ch-save">Save</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#ch-close').addEventListener('click', () => modal.remove());

  async function refreshList() {
    const history = await getCommentHistory(row.styleNo, row.trackingNumber, row.factoryLine, cutoffDate);
    const listEl = modal.querySelector('#ch-list');
    if (history.length === 0) {
      listEl.innerHTML = `<div style="padding:16px; text-align:center; color:var(--slate); font-size:12.5px;">No comments yet — add the first one below.</div>`;
      return;
    }
    listEl.innerHTML = history.map((entry) => {
      const commentDate = formatIsoDateShort(entry.createdAt) || '—';
      const reportTag = entry.reportPrintedDate
        ? `${formatDateShort(entry.reportPrintedDate)} — ${entry.reportFilename || 'report'}`
        : (entry.reportFilename || null);
      return `
      <div class="modal-list-row" style="display:block; padding:10px 12px;">
        <div style="font-size:11px; color:var(--slate); margin-bottom:3px;">
          ${commentDate}${reportTag ? ` &middot; <span class="mono">${escapeHtml(reportTag)}</span>` : ''}
        </div>
        <div style="font-size:13px; color:var(--ink); white-space:pre-wrap;">${escapeHtml(entry.comment)}</div>
      </div>
    `;
    }).join('');
    listEl.scrollTop = listEl.scrollHeight; // most recent comment visible by default
  }

  modal.querySelector('#ch-save').addEventListener('click', async () => {
    const textarea = modal.querySelector('#ch-new-comment');
    const text = textarea.value.trim();
    if (!text) return;
    await addCommentHistoryEntry(row.styleNo, row.trackingNumber, row.factoryLine, text, { filename: reportFilename, printedDate: reportPrintedDate });
    textarea.value = '';
    await refreshList();
    onSaved?.();
  });

  await refreshList();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
