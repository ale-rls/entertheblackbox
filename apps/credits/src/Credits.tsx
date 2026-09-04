import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

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
  const rollEnd = 1382;
  const progress = interpolate(frame, [rollStart, rollEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.linear,
  });
  const y = interpolate(progress, [0, 1], [1140, -3420]);
  const style = {transform: `translate3d(0, ${y}px, 0)`} satisfies CSSProperties;

  return (
    <div className="roll" style={style}>
      <section className="roll-title">
        <h2>Smartphonocracy</h2>
        <p>Eine interaktive KI-Performance</p>
      </section>

      <section className="credits-block credits-team">
        <Credit label="Konzept">Interrobang (Till Müller-Klug)</Credit>
        <Credit label="Video">Alexandre Silveira</Credit>
        <Credit label="Creative Coding">Manus Nijhoff</Credit>
        <Credit label="Musik">Friedrich Greiling</Credit>
        <Credit label="Produktionsleitung">
          ehrliche arbeit – freies Kulturbüro<br />
          Sandra Klöss
        </Credit>
        <Credit label="Company Management, Kommunikation & Social Media">
          Jack Willenbacher
        </Credit>
        <Credit label="Freie Mitarbeit Kommunikation">Tina Ebert</Credit>
      </section>

      <section className="credits-block credits-production">
        <Credit label="Produktion">Interrobang 2026</Credit>
        <Credit label="Koproduktion">
          Städel Museum und<br />
          Deutsches Theatermuseum
        </Credit>
      </section>

      <section className="statement exhibition">
        <div className="statement-kicker">Ausstellung</div>
        <p>
          Smartphonocracy ist Teil der Ausstellung<br />
          <span>“Future, now!”</span><br />
          im Deutschen Theatermuseum München.
        </p>
        <p className="dates">
          14. Oktober 2026<br />
          bis 1. August 2027
        </p>
      </section>

      <section className="statement disclosure">
        <div className="statement-kicker">Hinweis</div>
        <p>
          Diese Produktion enthält KI-generierte Videoinhalte sowie synthetisch erzeugte Stimmen
          (Text-to-Speech, ElevenLabs)
        </p>
      </section>

      <section className="end-mark">
        <div className="interrobang-logo" role="img" aria-label="Interrobang Performance" />
      </section>
    </div>
  );
};

export const Credits: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const masterOpacity = interpolate(
    frame,
    [0, 16, durationInFrames - 20, durationInFrames - 1],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill className="credits" style={{opacity: masterOpacity}}>
      <RollingCredits />
    </AbsoluteFill>
  );
};
