Role × permission grid for the users & roles page. Locked cells (e.g. Admin always has everything) render checked and disabled.

```jsx
<RoleMatrix roles={[{id:"admin",label:"Admin",locked:true},{id:"operator",label:"Operator"},{id:"viewer",label:"Read-only"}]}
  permissions={[{id:"tours.edit",label:"Edit tours"},{id:"bookings.cancel",label:"Cancel bookings",hint:"Destructive"}]}
  value={perms} onToggle={toggle} />
```
