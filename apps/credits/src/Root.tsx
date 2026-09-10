import {Composition} from 'remotion';
import {Credits} from './Credits';
import './styles.css';

export const VIDEO = {
  durationInFrames: 5051,
  fps: 24,
  height: 1080,
  width: 1920,
} as const;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SmartphonocracyCredits"
      component={Credits}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
