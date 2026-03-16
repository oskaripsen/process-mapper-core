import StartNode from './StartNode';
import EndNode from './EndNode';
import DefaultNode from './DefaultNode';
import DecisionNode from './DecisionNode';
import MergeNode from './MergeNode';

export const nodeTypes = {
  decision: DecisionNode,
  default: DefaultNode,
  merge: MergeNode,
  start: StartNode,
  end: EndNode,
};
