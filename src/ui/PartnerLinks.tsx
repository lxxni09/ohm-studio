/** Bauteile bei Partner-Shops kaufen – nur wenn eingeschaltet, Provision immer sichtbar beschriftet */
import { business, partners, PROVISION_HINWEIS } from '../business/config';
import { sourcedBom } from '../export/sourcing';
import type { Project } from '../ohm/model';

export function PartnerLinks({ project }: { project: Project }) {
  if (!business().partnerLinks) return null;
  const ps = partners();
  const rows = sourcedBom(project).slice(0, 30);
  const open = (url: string) => {
    const n = (globalThis as unknown as { ohmNative?: { openExternal(u: string): void } }).ohmNative;
    if (n) n.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  };
  const anyProvision = ps.some((p) => p.provision);
  return (
    <div className="partner-box">
      <div className="idea-sub">Bauteile bei Partner-Shops suchen</div>
      <table className="idea-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.bezeichnung}>
              <td>{r.anzahl}× {r.bezeichnung}</td>
              <td style={{ textAlign: 'right' }}>
                {ps.map((p) => (
                  <button key={p.id} className="btn partner-link" onClick={() => open(p.link(r.src.mpn || r.bezeichnung))} title={p.provision ? PROVISION_HINWEIS : 'ohne Provision'}>
                    {p.name}
                    {p.provision ? ' *' : ''}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="partner-note">{anyProvision ? `* Partner-Link: ${PROVISION_HINWEIS}` : 'Diese Links sind ohne Provision – Nodaris verdient daran nichts.'}</p>
    </div>
  );
}
