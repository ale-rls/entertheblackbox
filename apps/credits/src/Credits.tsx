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

const Marker: React.FC<{x: number; y: number; size: number; delay: number}> = ({
  x,
  y,
  size,
  delay,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    Math.sin((frame + delay) / 38),
    [-1, 1],
    [0.04, 0.16],
  );

  return (
    <div
      className="marker"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        opacity,
      }}
    />
  );
};

const Framing: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 1440], [-28, 28]);

  return (
    <AbsoluteFill className="framing" aria-hidden>
      <div className="hairline hairline-top" />
      <div className="hairline hairline-bottom" />
      <div className="corner corner-tl" />
      <div className="corner corner-tr" />
      <div className="corner corner-bl" />
      <div className="corner corner-br" />
      <div className="frame-index">60:00 / 24</div>
      <div className="scan" style={{transform: `translateY(${drift}px)`}} />
      <Marker x={8} y={18} size={22} delay={0} />
      <Marker x={89} y={12} size={11} delay={28} />
      <Marker x={94} y={73} size={28} delay={55} />
      <Marker x={5} y={82} size={13} delay={81} />
      <Marker x={84} y={91} size={9} delay={106} />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 28, 122, 166], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const scale = interpolate(frame, [0, 166], [0.985, 1.015], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill className="title-card" style={{opacity, transform: `scale(${scale})`}}>
      <div className="title-rule" />
      <h1>Smartphonocracy</h1>
      <p>Eine interaktive KI-Performance</p>
      <div className="title-rule title-rule-short" />
    </AbsoluteFill>
  );
};

const RollingCredits: React.FC = () => {
  const frame = useCurrentFrame();
  const rollStart = 150;
  const rollEnd = 1382;
  const progress = interpolate(frame, [rollStart, rollEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.linear,
  });
  const y = interpolate(progress, [0, 1], [1140, -3270]);
  const opacity = interpolate(frame, [140, 178, 1360, 1408], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const style = {opacity, transform: `translate3d(0, ${y}px, 0)`} satisfies CSSProperties;

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
        <Credit label="Freie Mitarbeit Kommunikation">Tina Ebert.</Credit>
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

      <section className="end-mark" aria-label="Interrobang 2026">
        <div className="end-glyphs">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p>Interrobang 2026</p>
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
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <Framing />
      <TitleCard />
      <RollingCredits />
      <div className="grain" aria-hidden />
    </AbsoluteFill>
  );
};
