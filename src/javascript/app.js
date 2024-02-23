/* global Ext MetricsManager Constants Rally _ */
Ext.define("CArABU.app.TSApp", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    defaults: { margin: 10 },
    config: {
        defaultSettings: {
            //DEPENDENCY_TYPE: Constants.SETTING.STORY,
            DEPENDENCY_TYPE: 'portfolioitem/feature',  //jt-set default to show Feature dependencies
            query: ''
        },
    },
    layout: {
        type: 'vbox',
        align: 'stretch',
    },
    items: [{
            xtype: 'container',
            layout: {
                type: 'hbox',
            },
            items: [
                { xtype: 'container', itemId: 'controlsArea'},
                { xtype: 'container', flex: 1 },
                { xtype: 'container', layout: { type: 'hbox' }, itemId: 'settingsArea' },
            ]
        },
        { xtype: 'container', itemId: 'filtersArea' },
    ],
    integrationHeaders: {
        name: "CArABU.app.TSApp"
    },
    showItemsWithoutDependencies: false,

    onTimeboxScopeChange: function(newTimeboxScope) {
        this.callParent(arguments);
        // TODO (tj) Ideally, we would just refresh the grid, but it is not clear to me how
        // to do that with a rallygridboard and preserve the timebox filter AND any existing
        // advanced filters from the filter plugin. Instead, if the page level timebox changes, just
        // relaunch the app.
        this.loadPrimaryStories(this.modelName);
    },

    initChosenPortfolioItemTypeName: function() {
        this.piStore = Ext.create('Rally.data.wsapi.Store', {
            model: Ext.identityFn('TypeDefinition'),
            fetch: ['Name', 'Ordinal', 'TypePath'],
            sorters: {
                property: 'Ordinal',
                direction: 'ASC'
            },
            filters: [{
                    property: 'Creatable',
                    operator: '=',
                    value: 'true'
                },
                {
                    property: 'Parent.Name',
                    operator: '=',
                    value: 'Portfolio Item'
                }
            ]
        })
        
        return this.piStore.load().then({
            scope: this,
            success: function(results) {
                return this.getSetting(Constants.SETTING.DEPENDENCY_TYPE) || results[0].get('Name');
            }
        });
    },

    showPortfolioDependencies: function() {
        return this.getSetting(Constants.SETTING.DEPENDENCY_TYPE) != Constants.SETTING.STORY;
    },

    getViewType: function() {
        return this.getSetting(Constants.SETTING.DEPENDENCY_TYPE);
    },

    getChosenPortfolioItemTypeName: function() {
        return this.chosenPortfolioItemTypeName || 'portfolioitem/feature'
    },

    launch: function() {

        this.initChosenPortfolioItemTypeName().then({
            scope: this,
            success: function(name) {
                this.chosenPortfolioItemTypeName = name;
                this.modelName = 'hierarchicalrequirement';
                if (this.showPortfolioDependencies()) {
                    this.modelName = this.getChosenPortfolioItemTypeName();
                }
            }
        }).then({
            scope: this,
            success: function() {
                return this.loadModel(this.modelName);
            }
        }).then({
            scope: this,
            success: function(model) {
                this.model = model;
                this.addFilters(this.modelName);
                this.addSettingsControls();
                // Initial load of stories triggered by change handler on the filter button
                //this.loadPrimaryStories(this.modelName);
            }
        })
    },

    loadPrimaryStories: function(modelName) {
        var grid = this.down('#grid');
        if (grid) {
            grid.setLoading('Loading...');
        }
        else {
            this.setLoading('Loading...');
        }
        this.artifactFetchFields = this.getFieldNames().concat(Constants.ARTIFACT_FETCH_FIELDS);

        var filters = [];

        if (this.getSetting('query')) {
            var querySetting = this.getSetting('query').replace(/\{user\}/g, this.getContext().getUser()._ref);
            var query_filter = Rally.data.QueryFilter.fromQueryString(querySetting);
            filters.push(query_filter);
        }

        if ((this.getSetting('DEPENDENCY_TYPE').indexOf('portfolioitem/') < 0) ||   //Not portfolio types
                    (this.piStore.data.items[0].get('TypePath').toLowerCase() === this.getSetting('DEPENDENCY_TYPE'))){ // but add first level portfolio type
            var timeboxScope = this.getContext().getTimeboxScope();
            if (timeboxScope) {
                filters.push(timeboxScope.getQueryFilter());
            }
        }

        var advancedFilters = this.getFiltersFromButton();
        if (advancedFilters) {
            filters.push(advancedFilters);
        }

        Ext.create('Rally.data.wsapi.Store', {
            model: modelName,
            autoLoad: true,
            filters: filters,
            limit: Infinity,
            pageSize: 500,  //jt-increase pageSize to reduce pagination for MS data
            listeners: {
                scope: this,
                load: function(store, records) {
                    MetricsManager.createDependencyStore(records)
                        .then({
                            scope: this,
                            success: function(store) {
                                this.addGrid(store)
                                this.setLoading(false);
                            }
                        })
                }
            },
            fetch: this.artifactFetchFields
        });
    },

    addFilters: function(modelName) {
        var controlsArea = this.down('#controlsArea');

        // Add column picker first so we know what fields to fetch during artifact load

        var alwaysSelectedColumns = ['FormattedID', 'Name'];
        if (this.showPortfolioDependencies()) {
            //if (this.piStore.data.items[0].get('TypePath').toLowerCase() === this.getSetting('DEPENDENCY_TYPE')){
            //    alwaysSelectedColumns.push('Release')
            //}
        
            /* required columns for MS FRTB */
            alwaysSelectedColumns.push('c_RAG');
            alwaysSelectedColumns.push('Tags');
            alwaysSelectedColumns.push('State');
            alwaysSelectedColumns.push('Owner');
            alwaysSelectedColumns.push('Milestones');
            alwaysSelectedColumns.push('PlannedStartDate');
            alwaysSelectedColumns.push('PlannedEndDate');
        }
        else {
            alwaysSelectedColumns.push('Iteration');
        }
        controlsArea.add({
            xtype: 'tsfieldpickerbutton',
            modelNames: [modelName],
            context: this.getContext(),
            stateful: true,
            stateId: this.getViewType() + 'fields', // columns specific to type of object
            alwaysSelectedValues: alwaysSelectedColumns,
            listeners: {
                fieldsupdated: function(fields) {
                    this.loadPrimaryStories(this.modelName);
                },
                scope: this
            }
        });

        // Add in-line filters
        controlsArea.add({
            xtype: 'rallyinlinefilterbutton',
            modelNames: [modelName],
            context: this.getContext(),
            stateful: true,
            stateId: this.getViewType() + 'filters', // filters specific to type of object
            listeners: {
                inlinefilterready: this.addInlineFilterPanel,
                inlinefilterchange: function(cmp) {
                    // This component fires change before it is fully added. Capture the
                    // reference to the filter button in the change handler so it can be used
                    // by loadPrimaryStories. Attempts to get to
                    // the button by using this.down('rallyinlinefilterbutton') will return null
                    // at this point.
                    this.filterButton = cmp;
                    this.loadPrimaryStories(this.modelName);
                },
                scope: this
            }
        });

    },

    addSettingsControls: function() {
        var me = this;
        var settingsArea = this.down('#settingsArea');

        settingsArea.add({
            xtype: 'rallycheckboxfield',
            fieldLabel: Constants.LABEL.SHOW_ALL,
            labelWidth: 200,
            name: 'showItemsWithoutDependencies',
            value: this.showItemsWithoutDependencies,
            listeners: {
                scope: this,
                change: function(checkbox, newValue) {
                    this.showItemsWithoutDependencies = newValue;
                    this.loadPrimaryStories(this.modelName);
                }
            }
        });

        settingsArea.add({
            xtype: 'rallybutton',
            margin: '0 10 0 10',
            text: 'Export',
            handler: function(a,b,c,d,e,f) {
                var grid = me.down('#grid');
                this.exportCSV(grid.store);
            },
            scope: me
        });
    },

    _downloadFiles: function( files ) {
        if ( files.length )
        {
            var data = files.pop();
            var format = files.pop();
            var file = files.pop();

            var href = "<a href='" + format + "," + encodeURIComponent(data) + "' download='" + file + "'></a>";

            var ml = Ext.DomHelper.insertAfter(window.document.getElementsByClassName('app')[0], href);
            ml.click();
//            ml.remove(); //Leaves them behind without this, but there is a timing issue: from click to remove.
            this._downloadFiles(files);
        }
    },

    exportCSV: function(store) {
        var data = this._exportStore(store);
        // fix: ' character was causing termination of csv file
        data = data.replace(/\'/g, " ");
        this._downloadFiles(
            [
                'depsExport.csv', 'data:text/csv;charset=utf8', data
            ]
        );

    },

    _exportStore: function(store) {
        var textOut = '';
        _.each(this.getFieldNames(), function(field) {
            textOut += field+',';
        })
        _.each(this.getFieldNames(), function(field) {
            textOut += 'Predecessor '+field+',';
        })
        _.each(this.getFieldNames(), function(field) {
            textOut += 'Successor '+field+',';
        });
        textOut = textOut.slice(0,-1)+'\\n';
        var me = this;
        _.each(store.getData().items, function(item) {
            textOut += me._getItemCSVString(item, 'STORY');
            textOut += me._getItemCSVString(item, 'PREDECESSOR');
            textOut += me._getItemCSVString(item, 'SUCCESSOR');
            textOut = textOut.slice(0,-1)+'\\n';
        });
        return textOut;
    },

    _getItemCSVString: function(item, witch) {
        var me = this;
        var retStr = '';

        var section =  item.get(witch);
        _.each(this.getFieldNames(), function(field) {
            if (section) {
                var fieldData = section.get(field);
                var details = me._getFieldTextAndEscape(fieldData);
                retStr += details;
            }
            retStr += ',';
        });
        return retStr;
    },

    _escapeForCSV: function(string) {
        string = "" + string;
        if (string.match(/,/)) {
            if (!string.match(/"/)) {
                string = '"' + string + '"';
            } else {
                string = string.replace(/,/g, ''); // comma's and quotes-- sorry, just lose the commas
            }
        }
        return string;
    },

    _getFieldText: function(fieldData) {
        var text;
        if (fieldData === null || fieldData === undefined) {
            text = '';

        // we capture object types here
        } else if (fieldData._refObjectName && !fieldData.getMonth) {
            text = fieldData.FormattedID + ": " + fieldData._refObjectName;

        // Date types here
        } else if (fieldData instanceof Date) {
            text = Ext.Date.format(fieldData, Constants.SETTING.DATEFORMAT);

        //The dependencies field is a synthetic one. We identity it by the field contents
        } else if (fieldData.Count !== undefined) {
            text = fieldData.Count.toString();
        }
        /*else if (!fieldData.match) { // not a string or object we recognize...blank it out
            text = '';
        } */ else {
            var delimiter = ",",
            rowDelimiter = "\r\n",
            re = new RegExp(delimiter + '|\"|\r|\n','g'),
            reHTML = new RegExp('<\/?[^>]+>', 'g'),
            reNbsp = new RegExp('&nbsp;','ig');

            text = fieldData;
            if (reHTML.test(text)){
                text = fieldData.replace('<br>',rowDelimiter);
                text = Ext.util.Format.htmlDecode(text);
                text = Ext.util.Format.stripTags(text);
            }
            if (reNbsp.test(text)){
                text = text.replace(reNbsp,' ');
            }

            if (re.test(text)){ //enclose in double quotes if we have the delimiters
                text = text.replace(/\"/g,'\"\"');
                text = Ext.String.format("\"{0}\"",text);
            }
        }

        return text;
    },

    _getFieldTextAndEscape: function(fieldData) {
        var string  = this._getFieldText(fieldData);

        return this._escapeForCSV(string);
    },


    addInlineFilterPanel: function(panel) {
        this.down('#filtersArea').add(panel);
    },

    getFiltersFromButton: function() {
        var filters = null;
        try {
            filters = this.filterButton.getWsapiFilter()
        }
        catch (ex) {
            // Ignore if filter button not yet available
        }

        return filters;
    },

    addGrid: function(store) {
        var grid = this.down('#grid');
        if (grid) {
            this.remove(grid);
        }

        this.add({
            xtype: 'rallygrid',
            itemId: 'grid',
            flex: 1,
            //width: this.getWidth(),
            showRowActionsColumn: false,
            enableColumnHide: false,
            sortableColumns: false,
            enableEditing: false,
            rowLines: false,
            store: store,
            pagingToolbarCfg: {  //jt-provide larger options for pageSizes to reduce pagination, especially for export
                pageSizes: [500, 1000]
            },
            columnCfgs: this.getColumns(),
        })
    },

    getFieldNames: function() {
        try {
            var result = this.down('tsfieldpickerbutton').getFields() || Constants.DEFAULT_COLUMNS;
        }
        catch (ex) {
            result = Constants.DEFAULT_COLUMNS
        }
        return result;
    },

    getColumns: function() {
        return [{
                xtype: 'gridcolumn',
                text: this.showPortfolioDependencies() ? this.getChosenPortfolioItemTypeName().split('/')[1] : Constants.LABEL.STORY,
                __subDataIndex: Constants.ID.STORY, // See Overrides.js
                columns: this.getSubColumns(Constants.ID.STORY)
            },
            {
                xtype: 'gridcolumn',
                tdCls: 'group-separator',
                width: 4,
            },
            {
                xtype: 'gridcolumn',
                text: Constants.LABEL.PREDECESSOR,
                __subDataIndex: Constants.ID.PREDECESSOR, // See Overrides.js
                columns: this.getSubColumns(Constants.ID.PREDECESSOR)
            },
            {
                xtype: 'gridcolumn',
                tdCls: 'group-separator',
                width: 4,
            },
            {
                xtype: 'gridcolumn',
                text: Constants.LABEL.SUCCESSOR,
                __subDataIndex: Constants.ID.SUCCESSOR, // See Overrides.js
                columns: this.getSubColumns(Constants.ID.SUCCESSOR)
            }
        ]
    },

    getSubColumns: function(subDataIndex) {
        var selectedFieldNames = this.getFieldNames();
        var columns = _.map(selectedFieldNames, function(selectedFieldName) {
            var column;
            var columnCfg = this.getColumnConfigFromModel(selectedFieldName);
            switch (columnCfg.dataIndex) {

                //TODO: feature or higher?
                case this.getChosenPortfolioItemTypeName():
                    column = {
                        xtype: 'gridcolumn',
                        text: columnCfg.modelField.displayName,
                        scope: this,
                        renderer: function(value, metaData, record, rowIndex, colIndex, store, view) {
                            return Renderers.featureRenderer(metaData, record, rowIndex, store, subDataIndex, columnCfg);
                        }
                    }
                    break;
                case 'Release':
                case 'Iteration':
                    // Color code Release and Iteration values
                    column = {
                        xtype: 'gridcolumn',
                        text: columnCfg.text,
                        scope: this,
                        renderer: function(value, metaData, record, rowIndex, colIndex, store, view) {
                            var result;
                            try {
                                switch (subDataIndex) {
                                    case Constants.ID.PREDECESSOR:
                                        result = this.predecessorIterationRenderer(record, columnCfg.dataIndex);
                                        break;
                                    case Constants.ID.SUCCESSOR:
                                        result = this.successorIterationRenderer(record, columnCfg.dataIndex);
                                        break;
                                    default:
                                        result = this.primaryIterationRenderer(record, columnCfg.dataIndex);
                                        break;
                                }
                            }
                            catch (ex) {
                                result = '';
                            }
                            // Determine the row color so that row colors alternate anytime the primary
                            // artifact changes.
                            Renderers.alternateRowModifier(metaData, record, rowIndex, store, subDataIndex);
                            return result;
                        }
                    }
                    break;
                case 'PlannedStartDate':
                    column = {
                        xtype: 'gridcolumn',
                        text: columnCfg.text,
                        scope: this,
                        renderer: function(value, metaData, record, rowIndex, colIndex, store, view) {
                            var result;
                            try {
                                switch (subDataIndex) {
                                    case Constants.ID.PREDECESSOR:
                                        result = this.predecessorStartRenderer(record, columnCfg.dataIndex);
                                        break;
                                    case Constants.ID.SUCCESSOR:
                                        result = this.successorStartRenderer(record, columnCfg.dataIndex);
                                        break;
                                    default:
                                        result = this.primaryHealthRenderer(record, columnCfg.dataIndex);
                                        break;
                                }
                            }
                            catch (ex) {
                                result = '';
                            }
                            // Determine the row color so that row colors alternate anytime the primary
                            // artifact changes.
                            Renderers.alternateRowModifier(metaData, record, rowIndex, store, subDataIndex);
                            return result;
                        }
                    }
                    break;
                case 'PlannedEndDate':
                    column = {
                        xtype: 'gridcolumn',
                        text: columnCfg.text,
                        scope: this,
                        renderer: function(value, metaData, record, rowIndex, colIndex, store, view) {
                            var result;
                            try {
                                switch (subDataIndex) {
                                    case Constants.ID.PREDECESSOR:
                                        result = this.predecessorEndRenderer(record, columnCfg.dataIndex);
                                        break;
                                    case Constants.ID.SUCCESSOR:
                                        result = this.successorEndRenderer(record, columnCfg.dataIndex);
                                        break;
                                    default:
                                        result = this.primaryHealthRenderer(record, columnCfg.dataIndex);
                                        break;
                                }
                            }
                            catch (ex) {
                                result = '';
                            }
                            // Determine the row color so that row colors alternate anytime the primary
                            // artifact changes.
                            Renderers.alternateRowModifier(metaData, record, rowIndex, store, subDataIndex);
                            return result;
                        }
                    }
                    break;
                default:
                    // All other columns use the default rendering (see Overrides.js for getting to the sub-data)
                    column = columnCfg;
            }
            column.height = 30; // Needed when a column is picked that has a two row title
            column.__subDataIndex = subDataIndex;
            column.isCellEditable = false;
            return column;
        }, this);

        return columns;
    },

    loadModel: function(modelName) {
        var deferred = new Deft.promise.Deferred;
        Rally.data.wsapi.ModelFactory.getModel({
            type: modelName,
            context: this.getContext(),
            success: function(model) {
                deferred.resolve(model);
            }
        });
        return deferred.getPromise();
    },

    getColumnConfigFromModel: function(fieldName) {
        var field = this.model.getField(fieldName);
        if (_.isUndefined(field)) {
            return null;
        }
        var builtConfig = Rally.ui.grid.FieldColumnFactory.getColumnConfigFromField(field, this.model);
        return builtConfig;
    },

    getStartDateField: function(timeboxField) {
        return timeboxField === 'Release' ? 'ReleaseStartDate' : 'StartDate';
    },

//TODO: add renderer for higher level portfolio item types

    primaryHealthRenderer: function(row, fieldName) {
        var primaryStory = row.get(Constants.ID.STORY);
        var value = Rally.util.HealthColorCalculator.calculateHealthColor({
              startDate: primaryStory.get('PlannedStartDate'),
              endDate: primaryStory.get('PlannedEndDate'),
              asOfDate: new Date(),
              percentComplete: primaryStory.get('PercentDoneByStoryPlanEstimate')
          }).hex;
        return '<div class="status-color" style="background-color:' + value + '">' + Ext.Date.format(primaryStory.get(fieldName), Constants.SETTING.DATEFORMAT) + '</div>';
    },

    predecessorStartRenderer: function(row) {
        var result;
        var primaryStory = row.get(Constants.ID.STORY);
        var predecessor = row.get(Constants.ID.PREDECESSOR);

        if (predecessor) {
            var colorClass = Constants.CLASS.OK;
            if (predecessor.get('PlannedStartDate') > primaryStory.get('PlannedStartDate')){
                colorClass = Constants.CLASS.WARNING
            }
            result = this.colorsRenderer(Ext.Date.format(predecessor.get('PlannedStartDate'), Constants.SETTING.DATEFORMAT), colorClass);
        }

        return result;
    },

    predecessorEndRenderer: function(row) {
        var result;
        var primaryStory = row.get(Constants.ID.STORY);
        var predecessor = row.get(Constants.ID.PREDECESSOR);

        if (predecessor) {
            var colorClass = Constants.CLASS.OK;
            if (predecessor.get('PlannedEndDate') > primaryStory.get('PlannedStartDate')){
                colorClass = Constants.CLASS.WARNING
            } else if (predecessor.get('PlannedEndDate') > primaryStory.get('PlannedEndDate')){
                colorClass = Constants.CLASS.ERROR;
            }
            result = this.colorsRenderer(Ext.Date.format(predecessor.get('PlannedEndDate'), Constants.SETTING.DATEFORMAT), colorClass);
        }

        return result;
    },

    successorStartRenderer: function(row) {
        var result;
        var primaryStory = row.get(Constants.ID.STORY);
        var successor = row.get(Constants.ID.SUCCESSOR);

        if (successor) {
            var colorClass = Constants.CLASS.OK;
            if (successor.get('PlannedEndDate') < primaryStory.get('PlannedEndDate')){
                colorClass = Constants.CLASS.WARNING
            } else if (successor.get('PlannedEndDate') < primaryStory.get('PlannedEndDate')){
                colorClass = Constants.CLASS.ERROR;
            }
            result = this.colorsRenderer(Ext.Date.format(successor.get('PlannedStartDate'), Constants.SETTING.DATEFORMAT), colorClass);
        }

        return result;
    },

    successorEndRenderer: function(row) {
        var result;
        var primaryStory = row.get(Constants.ID.STORY);
        var successor = row.get(Constants.ID.SUCCESSOR);

        if (successor) {
            var colorClass = Constants.CLASS.OK;
            if (successor.get('PlannedEndDate') < primaryStory.get('PlannedEndDate')){
                colorClass = Constants.CLASS.ERROR;
            }
            result = this.colorsRenderer(Ext.Date.format(successor.get('PlannedEndDate'), Constants.SETTING.DATEFORMAT), colorClass);
        }

        return result;
    },

    primaryIterationRenderer: function(row, timeboxField) {
        var colorClass = Constants.CLASS.OK;
        try {
            var primaryIterationName = row.get(Constants.ID.STORY).get(timeboxField).Name;
        }
        catch (ex) {
            primaryIterationName = Constants.LABEL.UNSCHEDULED;
            colorClass = Constants.CLASS.UNKNOWN;
        }

        return this.colorsRenderer(primaryIterationName, colorClass);
    },

    predecessorIterationRenderer: function(row, timeboxField) {
        var result;
        var startDateField = this.getStartDateField(timeboxField)
        var primaryStory = row.get(Constants.ID.STORY);
        var predecessor = row.get(Constants.ID.PREDECESSOR);

        if (predecessor) {
            var colorClass = Constants.CLASS.OK;
            var primaryIteration = primaryStory.get(timeboxField);
            var predecessorIteration = predecessor.get(timeboxField);

            var predecessorIterationName;

            if (predecessorIteration && primaryIteration) {
                predecessorIterationName = predecessorIteration.Name;
                var primaryStartDate = primaryIteration[startDateField];
                var predecessorStartDate = predecessorIteration[startDateField];

                if (predecessorStartDate < primaryStartDate) {
                    // Predecessor scheduled before primary. OK
                }
                else if (predecessorStartDate == primaryStartDate) {
                    // Predecessor scheduled in same iteration as primary. Warn
                    colorClass = Constants.CLASS.WARNING;
                }
                else {
                    // Predecessor scheduled after primary (or not scheduled). Error
                    colorClass = Constants.CLASS.ERROR;
                }
            }
            else if (!predecessorIteration && primaryIteration) {
                // No predecessor iteration when there is a primary. Highlight as error
                predecessorIterationName = Constants.LABEL.UNSCHEDULED;
                colorClass = Constants.CLASS.ERROR;
            }
            else if (predecessorIteration && !primaryIteration) {
                // Predecessor but no primary, don't highlight the iteration name
                predecessorIterationName = predecessorIteration.Name;
            }
            else if (!predecessorIteration && !primaryIteration) {
                // display nothing
                predecessorIterationName = '';
            }

            result = this.colorsRenderer(predecessorIterationName, colorClass);
        }

        return result;
    },

    successorIterationRenderer: function(row, timeboxField) {
        var result;
        var startDateField = this.getStartDateField(timeboxField);
        var primaryStory = row.get(Constants.ID.STORY);
        var dependency = row.get(Constants.ID.SUCCESSOR);

        if (dependency) {
            var colorClass = Constants.CLASS.OK;
            var primaryIteration = primaryStory.get(timeboxField);
            var dependencyIteration = dependency.get(timeboxField);

            var dependencyIterationName;

            if (dependencyIteration && primaryIteration) {
                dependencyIterationName = dependencyIteration.Name;
                var primaryStartDate = primaryIteration[startDateField];
                var dependencyStartDate = dependencyIteration[startDateField];

                if (dependencyStartDate > primaryStartDate) {
                    // dependency scheduled before primary. OK
                }
                else if (dependencyStartDate == primaryStartDate) {
                    // dependency scheduled in same iteration as primary. Warn
                    colorClass = Constants.CLASS.WARNING;
                }
                else {
                    // dependency scheduled after primary (or not scheduled). Error
                    colorClass = Constants.CLASS.ERROR;
                }
            }
            else if (!dependencyIteration && primaryIteration) {
                // No dependency iteration when there is a primary. Highlight as error
                dependencyIterationName = Constants.LABEL.UNSCHEDULED;
                colorClass = Constants.CLASS.UNKNOWN;
            }
            else if (dependencyIteration && !primaryIteration) {
                // dependency but no primary, don't highlight the iteration name
                dependencyIterationName = dependencyIteration.Name;
            }
            else if (!dependencyIteration && !primaryIteration) {
                // display nothing
                dependencyIterationName = '';
            }

            result = this.colorsRenderer(dependencyIterationName, colorClass);
        }

        return result;
    },

    /**
     * value: String to display
     * cls: Extra class to add to the cell
     */
    colorsRenderer: function(value, cls) {
        return '<div class="status-color ' + cls + '">' + value + '</div>';
    },

    getSettingsFields: function() {
        var data = [];
        
        if (this.piStore.data) {    //Can only do this after app has started and item types are available
            _.each(this.piStore.data.items, function(item) {
                data.push({
                    Name: item.get('Name'),
                    Value: item.get('TypePath').toLowerCase()
                });
            });
        }
        data.push({
            Name: 'User Story',
            Value: Constants.SETTING.STORY,
        });

        var store = Ext.create('Rally.data.custom.Store', {
            data: data
        });
        return [
            {
                xtype: 'rallycombobox',
                name: Constants.SETTING.DEPENDENCY_TYPE,
                label: Constants.LABEL.DEPENDENCY_TYPE,
                displayField: 'Name',
                valueField: 'Value',
                store: store
            },
            {
                type: 'query'
            }
        ];
    }
});
