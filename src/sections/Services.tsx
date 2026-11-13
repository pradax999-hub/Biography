/**
 * 04 — THE SERVICES
 * The three services of 1.0 with their prices and features. "Choose" selects
 * the service in the order form and scrolls to it.
 */
import { useRef } from 'react';
import { SERVICES, SERVICE_IDS, money, type ServiceId } from '../../shared/catalog';
import { Chapter } from '../components/Chapter';
import { Icon } from '../components/Icon';
import { AnchorLink } from '../components/Magnetic';
import { Reveal, SplitReveal } from '../components/Text';
import { useI18n } from '../i18n/I18nProvider';
import { finePointer } from '../lib/motion';
import { useOrder } from '../order/OrderContext';

const ICON: Record<ServiceId, string> = { website: 'web', video: 'film', app: 'app' };
const FEATURED: ServiceId = 'website';

function ServiceCard({ id, index }: { id: ServiceId; index: number }) {
  const { t } = useI18n();
  const { pick } = useOrder();
  const ref = useRef<HTMLElement>(null);
  const service = SERVICES[id];

  // a soft light follows the pointer across the card
  const onMove = (e: React.PointerEvent): void => {
    if (!finePointer || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--mx', `${e.clientX - r.left}px`);
    ref.current.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <Reveal delay={index} className="svc-cell">
      <article className={`svc ${id === FEATURED ? 'is-featured' : ''}`} ref={ref} onPointerMove={onMove}>
        <header className="svc-top">
          <span className="svc-index">S/{String(index + 1).padStart(2, '0')}</span>
          {id === FEATURED && <span className="badge">{t('svc.popular')}</span>}
          <span className="svc-icon">
            <Icon name={ICON[id]} />
          </span>
        </header>
        <h3>{t(`svc.${id}.name`)}</h3>
        <p className="desc">{t(`svc.${id}.desc`)}</p>
        <p className="price">
          {service.from && <small>{t('price.from')}</small>}
          <span>{money(service.price)}</span>
        </p>
        <ul className="feat">
          {[1, 2, 3, 4].map(n => (
            <li key={n}>
              <Icon name="check" />
              <span>{t(`svc.${id}.f${n}`)}</span>
            </li>
          ))}
        </ul>
        <AnchorLink className={`btn ${id === FEATURED ? 'btn-primary' : 'btn-ghost'}`} href="#order" onClick={() => pick(id)} data-cursor={t('cur.pick')}>
          <span>{t('svc.pick')}</span>
          <Icon name="arrow" className="arrow" />
        </AnchorLink>
      </article>
    </Reveal>
  );
}

export function Services() {
  const { t } = useI18n();
  return (
    <section className="section services" id="services" data-scene="services">
      <div className="wrap">
        <Chapter index="04" name="The Services" label={t('svc.eyebrow')} />
        <SplitReveal html={t('svc.title')} className="h2" />
        <div className="svc-grid">
          {SERVICE_IDS.map((id, i) => (
            <ServiceCard id={id} index={i} key={id} />
          ))}
        </div>
        <Reveal as="p" className="services-note">
          {t('svc.note')}
        </Reveal>
      </div>
    </section>
  );
}
