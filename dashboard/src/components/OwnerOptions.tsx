import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select"

export type OwnerUser = { id: number; name: string; group_id: number | null }
export type OwnerGroup = { id: number; name: string }

// Select options for owner pickers/filters. Only super fetches groups, so passing them
// sections the users by group; everyone else gets a flat list. Current user marked (أنا).
export function OwnerOptions({ users, groups, meId }: { users: OwnerUser[]; groups: OwnerGroup[]; meId: number }) {
  const item = (u: OwnerUser) => (
    <SelectItem key={u.id} value={String(u.id)}>
      {u.name}
      {u.id === meId && <span className="ms-1 text-muted-foreground">(أنا)</span>}
    </SelectItem>
  )
  if (!groups.length) return <>{users.map(item)}</>
  const ungrouped = users.filter((u) => !u.group_id)
  return (
    <>
      {groups.map((g) => {
        const members = users.filter((u) => u.group_id === g.id)
        return members.length ? (
          <SelectGroup key={g.id}>
            <SelectLabel>{g.name}</SelectLabel>
            {members.map(item)}
          </SelectGroup>
        ) : null
      })}
      {ungrouped.length > 0 && (
        <SelectGroup>
          <SelectLabel>بدون مجموعة</SelectLabel>
          {ungrouped.map(item)}
        </SelectGroup>
      )}
    </>
  )
}
