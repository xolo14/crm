import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  onBulkDelete: () => void;
  canBulkDelete: boolean;
  entityName?: string;
}

export function BulkActionsBar({ selectedCount, onBulkDelete, canBulkDelete, entityName = 'items' }: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg mb-4 border border-border">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      {canBulkDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2">
              <Trash2 className="h-4 w-4" />
              Delete Selected
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedCount} {entityName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the selected {entityName}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

interface SelectAllCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function SelectAllCheckbox({ checked, indeterminate, onCheckedChange }: SelectAllCheckboxProps) {
  return (
    <Checkbox
      checked={indeterminate ? 'indeterminate' : checked}
      onCheckedChange={onCheckedChange}
      aria-label="Select all"
    />
  );
}

interface RowCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function RowCheckbox({ checked, onCheckedChange }: RowCheckboxProps) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label="Select row"
    />
  );
}
