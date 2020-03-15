import {QueryBuilder} from "./QueryBuilder.ts";
import {ObjectLiteral} from "../common/ObjectLiteral.ts";
import {ObjectType} from "../common/ObjectType.ts";
import {Connection} from "../connection/Connection.ts";
import {QueryRunner} from "../query-runner/QueryRunner.ts";
import {WhereExpression} from "./WhereExpression.ts";
import {Brackets} from "./Brackets.ts";
import {DeleteResult} from "./result/DeleteResult.ts";
import {ReturningStatementNotSupportedError} from "../error/ReturningStatementNotSupportedError.ts";
import {BroadcasterResult} from "../subscriber/BroadcasterResult.ts";
import {EntitySchema} from "../index.ts";
import {AbstractQueryBuilderFactory} from "./AbstractQueryBuilderFactory.ts";
import {PostgresDriver} from "../driver/postgres/PostgresDriver.ts";

/**
 * Allows to build complex sql queries in a fashion way and execute those queries.
 */
export class DeleteQueryBuilder<Entity> extends QueryBuilder<Entity> implements WhereExpression {

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(queryBuilderFactory: AbstractQueryBuilderFactory, connectionOrQueryBuilder: Connection|QueryBuilder<any>, queryRunner?: QueryRunner) {
        super(queryBuilderFactory, connectionOrQueryBuilder as any, queryRunner);
        this.expressionMap.aliasNamePrefixingEnabled = false;
    }

    // -------------------------------------------------------------------------
    // Public Implemented Methods
    // -------------------------------------------------------------------------

    /**
     * Gets generated sql query without parameters being replaced.
     */
    getQuery(): string {
        let sql = this.createDeleteExpression();
        return sql.trim();
    }

    /**
     * Executes sql generated by query builder and returns raw database results.
     */
    async execute(): Promise<DeleteResult> {
        const [sql, parameters] = this.getQueryAndParameters();
        const queryRunner = this.obtainQueryRunner();
        let transactionStartedByUs: boolean = false;

        try {

            // start transaction if it was enabled
            if (this.expressionMap.useTransaction === true && queryRunner.isTransactionActive === false) {
                await queryRunner.startTransaction();
                transactionStartedByUs = true;
            }

            // call before deletion methods in listeners and subscribers
            if (this.expressionMap.callListeners === true && this.expressionMap.mainAlias!.hasMetadata) {
                const broadcastResult = new BroadcasterResult();
                queryRunner.broadcaster.broadcastBeforeRemoveEvent(broadcastResult, this.expressionMap.mainAlias!.metadata);
                if (broadcastResult.promises.length > 0) await Promise.all(broadcastResult.promises);
            }

            // execute query
            const deleteResult = new DeleteResult();
            const result = await queryRunner.query(sql, parameters);

            const driver = queryRunner.connection.driver;
            if (false/*driver instanceof MysqlDriver || driver instanceof AuroraDataApiDriver*/) { // TODO(uki00a) uncomment this when MysqlDriver is implemented.
                deleteResult.raw = result;
                deleteResult.affected = result.affectedRows;

            } else if (
                /*driver instanceof SqlServerDriver ||*/ // TODO(uki00a) uncomment this when SqlServerDriver is implemented.
                driver instanceof PostgresDriver
                /*|| driver instanceof CockroachDriver*/ ) { // TODO(uki00a) uncomment this when CockroachDriver is implemented.
                deleteResult.raw = result[0] ? result[0] : null;
                // don't return 0 because it could confuse. null means that we did not receive this value
                deleteResult.affected = typeof result[1] === "number" ? result[1] : null;

            } else if (false/*driver instanceof OracleDriver*/) { // TODO(uki00a) uncomment this when OracleDriver is implemented
                deleteResult.affected = result;

            } else {
                deleteResult.raw = result;
            }

            // call after deletion methods in listeners and subscribers
            if (this.expressionMap.callListeners === true && this.expressionMap.mainAlias!.hasMetadata) {
                const broadcastResult = new BroadcasterResult();
                queryRunner.broadcaster.broadcastAfterRemoveEvent(broadcastResult, this.expressionMap.mainAlias!.metadata);
                if (broadcastResult.promises.length > 0) await Promise.all(broadcastResult.promises);
            }

            // close transaction if we started it
            if (transactionStartedByUs)
                await queryRunner.commitTransaction();

            return deleteResult;

        } catch (error) {

            // rollback transaction if we started it
            if (transactionStartedByUs) {
                try {
                    await queryRunner.rollbackTransaction();
                } catch (rollbackError) { }
            }
            throw error;

        } finally {
            if (queryRunner !== this.queryRunner) { // means we created our own query runner
                await queryRunner.release();
            }
            /* // TODO(uki00a) uncomment this when SqljsDriver is implemented.
            if (this.connection.driver instanceof SqljsDriver && !queryRunner.isTransactionActive) {
                await this.connection.driver.autoSave();
            }
            */
        }
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Specifies FROM which entity's table select/update/delete will be executed.
     * Also sets a main string alias of the selection data.
     */
    from<T>(entityTarget: ObjectType<T>|EntitySchema<T>|string, aliasName?: string): DeleteQueryBuilder<T> {
        entityTarget = entityTarget instanceof EntitySchema ? entityTarget.options.name : entityTarget;
        const mainAlias = this.createFromAlias(entityTarget, aliasName);
        this.expressionMap.setMainAlias(mainAlias);
        return (this as any) as DeleteQueryBuilder<T>;
    }

    /**
     * Sets WHERE condition in the query builder.
     * If you had previously WHERE expression defined,
     * calling this function will override previously set WHERE conditions.
     * Additionally you can add parameters used in where expression.
     */
    where(where: Brackets|string|((qb: this) => string)|ObjectLiteral|ObjectLiteral[], parameters?: ObjectLiteral): this {
        this.expressionMap.wheres = []; // don't move this block below since computeWhereParameter can add where expressions
        const condition = this.computeWhereParameter(where);
        if (condition)
            this.expressionMap.wheres = [{ type: "simple", condition: condition }];
        if (parameters)
            this.setParameters(parameters);
        return this;
    }

    /**
     * Adds new AND WHERE condition in the query builder.
     * Additionally you can add parameters used in where expression.
     */
    andWhere(where: Brackets|string|((qb: this) => string), parameters?: ObjectLiteral): this {
        this.expressionMap.wheres.push({ type: "and", condition: this.computeWhereParameter(where) });
        if (parameters) this.setParameters(parameters);
        return this;
    }

    /**
     * Adds new OR WHERE condition in the query builder.
     * Additionally you can add parameters used in where expression.
     */
    orWhere(where: Brackets|string|((qb: this) => string), parameters?: ObjectLiteral): this {
        this.expressionMap.wheres.push({ type: "or", condition: this.computeWhereParameter(where) });
        if (parameters) this.setParameters(parameters);
        return this;
    }

    /**
     * Adds new AND WHERE with conditions for the given ids.
     */
    whereInIds(ids: any|any[]): this {
        return this.where(this.createWhereIdsExpression(ids));
    }

    /**
     * Adds new AND WHERE with conditions for the given ids.
     */
    andWhereInIds(ids: any|any[]): this {
        return this.andWhere(this.createWhereIdsExpression(ids));
    }

    /**
     * Adds new OR WHERE with conditions for the given ids.
     */
    orWhereInIds(ids: any|any[]): this {
        return this.orWhere(this.createWhereIdsExpression(ids));
    }
    /**
     * Optional returning/output clause.
     * This will return given column values.
     */
    output(columns: string[]): this;

    /**
     * Optional returning/output clause.
     * Returning is a SQL string containing returning statement.
     */
    output(output: string): this;

    /**
     * Optional returning/output clause.
     */
    output(output: string|string[]): this;

    /**
     * Optional returning/output clause.
     */
    output(output: string|string[]): this {
        return this.returning(output);
    }

    /**
     * Optional returning/output clause.
     * This will return given column values.
     */
    returning(columns: string[]): this;

    /**
     * Optional returning/output clause.
     * Returning is a SQL string containing returning statement.
     */
    returning(returning: string): this;

    /**
     * Optional returning/output clause.
     */
    returning(returning: string|string[]): this;

    /**
     * Optional returning/output clause.
     */
    returning(returning: string|string[]): this {

        // not all databases support returning/output cause
        if (!this.connection.driver.isReturningSqlSupported())
            throw new ReturningStatementNotSupportedError();

        this.expressionMap.returning = returning;
        return this;
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Creates DELETE express used to perform query.
     */
    protected createDeleteExpression() {
        const tableName = this.getTableName(this.getMainTableName());
        const whereExpression = this.createWhereExpression();
        const returningExpression = this.createReturningExpression();

        if (returningExpression && (this.connection.driver instanceof PostgresDriver/* || this.connection.driver instanceof CockroachDriver*/)) { // TODO(uki00a) uncomment this when CockroachDriver is implemented.
            return `DELETE FROM ${tableName}${whereExpression} RETURNING ${returningExpression}`;

        } else if (false/*returningExpression !== "" && this.connection.driver instanceof SqlServerDriver*/) { // TODO(uki00a) uncomment this when SqlServerDriver is implemented.
            return `DELETE FROM ${tableName} OUTPUT ${returningExpression}${whereExpression}`;

        } else {
            return `DELETE FROM ${tableName}${whereExpression}`;
        }
    }

}
