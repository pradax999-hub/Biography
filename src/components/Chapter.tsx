import { Reveal } from './Text';

interface Props {
  /** "02" */
  index: string;
  /** English chapter name, part of the art direction: "The Creator" */
  name: string;
  /** translated section label */
  label: string;
}

/** The thin header line that opens every chapter of the page. */
export function Chapter({ index, name, label }: Props) {
  return (
    <Reveal className="chapter">
      <span className="chapter-index">{index}</span>
      <span className="chapter-name">{name}</span>
      <i className="chapter-rule" />
      <span className="chapter-label">{label}</span>
    </Reveal>
  );
}
