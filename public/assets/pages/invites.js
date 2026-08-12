(function () {
  const session = Auth.require('tutor');
  if (!session) return;
  location.replace('/students.html#invitations');
})();
