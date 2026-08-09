export interface IdentityRepository<User, Session> {
  findUserByEmail(email: string): User | null;
  findUserById(id: string): User | null;
  saveUser(user: User): void;
  saveSession(session: Session): void;
  deleteSession(token: string): void;
}
