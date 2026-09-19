import type { ReactNode } from "react";
import type { TaskRecord } from "../../contract";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Pill } from "@/components/ui/pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { isOverdue, priorityLabel, priorityVariant } from "../../lib/task-format";

export interface CompactTaskRowProps {
  uuid: string;
  task: TaskRecord | undefined;
  pinned?: boolean;
  badge?: ReactNode;
  onOpen?: () => void;
  onComplete?: () => void;
  onTogglePin?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onClear?: () => void;
}

function IconAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          className={COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS}
          aria-label={label}
          onClick={onClick}
        >
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CompactTaskRow(props: CompactTaskRowProps) {
  const { task, pinned, badge } = props;
  if (task === undefined) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex-1">Task no longer exists</span>
        {props.onClear && <IconAction label="Clear" icon="X" onClick={props.onClear} />}
      </div>
    );
  }
  const finished = task.status === "completed" || task.status === "deleted";
  return (
    <div className="@container flex items-center gap-1 px-3 py-2">
      <button
        type="button"
        onClick={props.onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        <span
          className={cn(
            "w-full truncate text-sm text-foreground",
            finished && "text-muted-foreground line-through",
          )}
        >
          {task.description}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {task.project && (
            <Pill variant="outline" size="sm">
              {task.project}
            </Pill>
          )}
          {task.priority && (
            <Pill variant={priorityVariant(task.priority)} size="sm">
              {priorityLabel(task.priority)}
            </Pill>
          )}
          {isOverdue(task) && (
            <Pill variant="destructive" size="sm">
              Overdue
            </Pill>
          )}
          {badge}
        </span>
      </button>
      {props.onMoveUp && <IconAction label="Move up" icon="ArrowUp" onClick={props.onMoveUp} />}
      {props.onMoveDown && (
        <IconAction label="Move down" icon="ArrowDown" onClick={props.onMoveDown} />
      )}
      {props.onTogglePin && (
        <IconAction
          label={pinned ? "Unpin" : "Pin"}
          icon={pinned ? "PinOff" : "Pin"}
          onClick={props.onTogglePin}
        />
      )}
      {props.onComplete && !finished && (
        <IconAction label="Complete" icon="Check" onClick={props.onComplete} />
      )}
    </div>
  );
}
