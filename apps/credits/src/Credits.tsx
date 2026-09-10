import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

/**
 * Credits roll template.
 *
 * The roll mechanics, typography, and timing curves are the reusable part; the
 * names, coproducers, and exhibition text below are placeholders to be replaced
 * with this production's own credits. Add the music back as an `Html5Audio`
 * track once the file exists in `apps/display/src/assets/` — see the render
 * script in package.json.
 */

type CreditProps = {
  label: string;
  children: ReactNode;
};

const Credit: React.FC<CreditProps> = ({label, children}) => (
  <div className="credit-row">
    <div className="credit-label">{label}</div>
    <div className="credit-name">{children}</div>
  </div>
);

const RollingCredits: React.FC = () => {
  const frame = useCurrentFrame();
  const rollStart = 0;
  const rollEnd = 1440;
  const progress = interpolate(frame, [rollStart, rollEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.linear,
  });
  const y = interpolate(progress, [0, 1], [1140, -3820]);
  const style = {transform: `translate3d(0, ${y}px, 0)`} satisfies CSSProperties;

  return (
    <div className="roll" style={style}>
      <section className="roll-title">
        <h2>Enter the Blackbox</h2>
        <p>TODO: subtitle</p>
      </section>

      <section className="credits-block credits-team">
        <Credit label="Konzept">TODO</Credit>
        <Credit label="Video">TODO</Credit>
        <Credit label="Creative Coding">TODO</Credit>
        <Credit label="Musik">TODO</Credit>
        <Credit label="Produktionsleitung">TODO</Credit>
      </section>

      <section className="credits-block credits-production">
        <Credit label="Produktion">TODO</Credit>
        <Credit label="Koproduktion">TODO</Credit>
      </section>

      <section className="statement exhibition">
        <div className="statement-kicker">TODO: Spielort / Ausstellung</div>
        <p>TODO: venue and run</p>
      </section>

      <section className="statement disclosure">
        <div className="statement-kicker">Hinweis</div>
        <p>TODO: confirm whether this production needs an AI-content disclosure</p>
      </section>

      <section className="end-mark">
        <div className="interrobang-logo" role="img" aria-label="Interrobang Performance" />
      </section>
    </div>
  );
};

export const Credits: React.FC = () => {
  const frame = useCurrentFrame();
  const masterOpacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill className="credits" style={{opacity: masterOpacity}}>
      <RollingCredits />
    </AbsoluteFill>
  );
};
